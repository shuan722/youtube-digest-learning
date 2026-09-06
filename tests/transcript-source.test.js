const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// Values built inside a vm context carry that context's prototypes, which
// deepStrictEqual rejects. Compare their plain serialized form instead.
const plain = (value) => JSON.parse(JSON.stringify(value));

const BASE_SETTINGS = {
  provider: "deepseek",
  aiApiKey: "test-key",
  aiBaseUrl: "https://api.deepseek.com",
  aiModel: "deepseek-v4-flash",
  supadataApiKey: "",
  allowSupadataFallback: false,
};

// The one payload shape both sources speak, which is Supadata's.
const NATIVE_RESPONSE = {
  success: true,
  via: "caption-api",
  payload: {
    content: [
      { text: ">> Welcome back", offset: 0, duration: 2000, lang: "en" },
      { text: "to the channel", offset: 65_000, duration: 3000, lang: "en" },
      { text: "   ", offset: 70_000, duration: 1000, lang: "en" },
    ],
    lang: "en",
    availableLangs: ["en", "es"],
  },
};

const NO_CAPTIONS_RESPONSE = {
  success: false,
  error: "NO_TRANSCRIPT",
  message: "This video has no subtitle track.",
};

/**
 * Boots background.js with just enough of the Chrome surface for the
 * transcript pipeline: a YouTube tab to target, a content script that answers
 * extractTranscript, and a real in-memory storage.
 */
function loadTranscriptHelpers({
  settings = BASE_SETTINGS,
  tabs = [{ id: 7, active: true, url: "https://www.youtube.com/watch?v=abc123XYZ" }],
  contentResponse = NATIVE_RESPONSE,
  fetchImpl = () => Promise.reject(new Error("unexpected network call")),
  storage = {},
} = {}) {
  const listeners = { addListener() {} };
  const calls = { tabMessages: [], fetch: [] };
  const store = { ytd_settings: settings, ...storage };
  const sandbox = {
    console,
    URL,
    fetch: (...args) => {
      calls.fetch.push(String(args[0]));
      return fetchImpl(...args);
    },
    AbortController,
    setTimeout: (callback) => {
      callback();
      return 0;
    },
    clearTimeout() {},
    importScripts() {},
    chrome: {
      storage: {
        local: {
          setAccessLevel: () => Promise.resolve(),
          get: async (key) => {
            if (key === null || key === undefined) return { ...store };
            const keys = Array.isArray(key) ? key : [key];
            return Object.fromEntries(
              keys.filter((k) => k in store).map((k) => [k, store[k]]),
            );
          },
          set: async (values) => Object.assign(store, values),
          remove: async (key) => {
            for (const k of Array.isArray(key) ? key : [key]) delete store[k];
          },
        },
      },
      action: { onClicked: listeners },
      sidePanel: { setPanelBehavior() {}, setOptions: () => Promise.resolve() },
      runtime: {
        onInstalled: listeners,
        onMessage: listeners,
        openOptionsPage() {},
        getURL: (resourcePath) => `chrome-extension://test/${resourcePath}`,
        sendMessage: () => Promise.resolve({}),
      },
      tabs: {
        onUpdated: listeners,
        onActivated: listeners,
        query: async () => tabs,
        sendMessage: async (tabId, message) => {
          calls.tabMessages.push({ tabId, action: message.action });
          if (contentResponse instanceof Error) throw contentResponse;
          return contentResponse;
        },
      },
    },
    YTD_SETTINGS: {
      STORAGE_KEY: "ytd_settings",
      normalize: (value) => value,
      chatCompletionsUrl: (baseUrl) => `${baseUrl}/chat/completions`,
      canonicalYouTubeUrl: (videoId) =>
        `https://www.youtube.com/watch?v=${videoId}`,
    },
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(read("background.js"), sandbox);
  return { helpers: sandbox.__YTD_TRANSCRIPT_SOURCE_TESTING__, calls, store };
}

// ---------------------------------------------------------------------------
// The shared payload contract
// ---------------------------------------------------------------------------

test("a transcript payload becomes timestamped transcript text", () => {
  const { helpers } = loadTranscriptHelpers();
  const result = helpers.buildTranscriptResult(
    NATIVE_RESPONSE.payload,
    "youtube-caption-api",
  );

  assert.equal(result.success, true);
  assert.equal(result.source, "youtube-caption-api");
  assert.equal(result.language, "en");
  assert.deepEqual(plain(result.availableLanguages), ["en", "es"]);
  // Blank chunks are dropped and the ">>" speaker marker is stripped.
  assert.equal(result.transcript.length, 2);
  assert.equal(result.transcript[0].text, "Welcome back");
  assert.equal(result.transcript[1].start, 65);
  assert.equal(result.transcript[1].duration, 3);
  assert.equal(result.transcriptText, "Welcome back to the channel");
  assert.equal(
    result.transcriptTextTimestamped,
    "[0:00] Welcome back\n[1:05] to the channel",
  );
});

test("native captions and Supadata produce identical results", async () => {
  // This is the whole point of sharing one payload shape: given the same
  // content, neither source can drift from the other.
  const native = await loadTranscriptHelpers().helpers.handleFetchTranscript(
    "abc123XYZ",
  );

  const supadata = await loadTranscriptHelpers({
    settings: {
      ...BASE_SETTINGS,
      allowSupadataFallback: true,
      supadataApiKey: "supadata-secret",
    },
    contentResponse: NO_CAPTIONS_RESPONSE,
    fetchImpl: () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => NATIVE_RESPONSE.payload,
      }),
  }).helpers.handleFetchTranscript("abc123XYZ");

  assert.equal(native.success, true);
  assert.equal(supadata.success, true);
  assert.deepEqual(plain(native.transcript), plain(supadata.transcript));
  assert.equal(native.transcriptText, supadata.transcriptText);
  assert.equal(
    native.transcriptTextTimestamped,
    supadata.transcriptTextTimestamped,
  );
  assert.equal(native.language, supadata.language);
  assert.deepEqual(
    plain(native.availableLanguages),
    plain(supadata.availableLanguages),
  );
  // Only the provenance label differs.
  assert.equal(native.source, "youtube-caption-api");
  assert.equal(supadata.source, "supadata");
});

test("a payload with no readable text reports EMPTY_TRANSCRIPT", () => {
  const { helpers } = loadTranscriptHelpers();
  const result = helpers.buildTranscriptResult(
    { content: [{ text: ">>", offset: 0 }], lang: "en" },
    "youtube-caption-api",
  );

  assert.equal(result.success, false);
  assert.equal(result.error, "EMPTY_TRANSCRIPT");
});

// ---------------------------------------------------------------------------
// Source selection
// ---------------------------------------------------------------------------

test("YouTube watch, shorts, and junk URLs resolve to video IDs", () => {
  const { helpers } = loadTranscriptHelpers();

  assert.equal(
    helpers.videoIdFromUrl("https://www.youtube.com/watch?v=abc123XYZ&t=42"),
    "abc123XYZ",
  );
  assert.equal(
    helpers.videoIdFromUrl("https://m.youtube.com/shorts/abc123XYZ"),
    "abc123XYZ",
  );
  assert.equal(helpers.videoIdFromUrl("https://example.com/watch?v=abc123XYZ"), "");
  assert.equal(helpers.videoIdFromUrl("not a url"), "");
});

test("the content script is asked first, with no Supadata request", async () => {
  const { helpers, calls } = loadTranscriptHelpers();

  const result = await helpers.handleFetchTranscript("abc123XYZ");

  assert.equal(result.success, true);
  assert.equal(result.source, "youtube-caption-api");
  assert.deepEqual(plain(calls.tabMessages), [
    { tabId: 7, action: "extractTranscript" },
  ]);
  assert.deepEqual(calls.fetch, []);
});

test("a tab without the content script asks for a reload", async () => {
  const { helpers, calls } = loadTranscriptHelpers({
    settings: { ...BASE_SETTINGS, supadataApiKey: "supadata-secret" },
    contentResponse: new Error("Receiving end does not exist"),
  });

  const result = await helpers.handleFetchTranscript("abc123XYZ");

  assert.equal(result.success, false);
  assert.equal(result.error, "NO_YOUTUBE_TAB");
  assert.match(result.message, /Reload the YouTube page/);
  assert.deepEqual(calls.fetch, []);
});

test("no open YouTube tab is reported instead of silently paying Supadata", async () => {
  const { helpers, calls } = loadTranscriptHelpers({
    settings: { ...BASE_SETTINGS, supadataApiKey: "supadata-secret" },
    tabs: [],
  });

  const result = await helpers.handleFetchTranscript("abc123XYZ");

  assert.equal(result.success, false);
  assert.equal(result.error, "NO_YOUTUBE_TAB");
  assert.deepEqual(calls.tabMessages, []);
  assert.deepEqual(calls.fetch, []);
});

test("Supadata runs only once the fallback is enabled and keyed", async () => {
  const supadataResponse = () =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () => NATIVE_RESPONSE.payload,
    });

  const keyedButDisabled = loadTranscriptHelpers({
    settings: { ...BASE_SETTINGS, supadataApiKey: "supadata-secret" },
    contentResponse: NO_CAPTIONS_RESPONSE,
    fetchImpl: supadataResponse,
  });
  const disabled =
    await keyedButDisabled.helpers.handleFetchTranscript("abc123XYZ");
  assert.equal(disabled.success, false);
  assert.deepEqual(keyedButDisabled.calls.fetch, []);

  const enabledWithoutKey = loadTranscriptHelpers({
    settings: { ...BASE_SETTINGS, allowSupadataFallback: true },
    contentResponse: NO_CAPTIONS_RESPONSE,
    fetchImpl: supadataResponse,
  });
  const unkeyed =
    await enabledWithoutKey.helpers.handleFetchTranscript("abc123XYZ");
  assert.equal(unkeyed.success, false);
  assert.deepEqual(enabledWithoutKey.calls.fetch, []);

  const enabled = loadTranscriptHelpers({
    settings: {
      ...BASE_SETTINGS,
      allowSupadataFallback: true,
      supadataApiKey: "supadata-secret",
    },
    contentResponse: NO_CAPTIONS_RESPONSE,
    fetchImpl: supadataResponse,
  });
  const result = await enabled.helpers.handleFetchTranscript("abc123XYZ");
  assert.equal(result.success, true);
  assert.equal(result.source, "supadata");
  assert.equal(enabled.calls.fetch.length, 1);
  assert.match(
    enabled.calls.fetch[0],
    /^https:\/\/api\.supadata\.ai\/v1\/transcript\?/,
  );
  // Caption-only scope: the paid AI transcription mode must stay locked off.
  assert.match(enabled.calls.fetch[0], /mode=native/);
});

test("a failed Supadata fallback still reports the native failure", async () => {
  const { helpers } = loadTranscriptHelpers({
    settings: {
      ...BASE_SETTINGS,
      allowSupadataFallback: true,
      supadataApiKey: "supadata-secret",
    },
    contentResponse: NO_CAPTIONS_RESPONSE,
    fetchImpl: () =>
      Promise.resolve({ ok: false, status: 401, json: async () => ({}) }),
  });

  const result = await helpers.handleFetchTranscript("abc123XYZ");

  assert.equal(result.success, false);
  assert.equal(result.error, "NO_TRANSCRIPT");
  assert.match(result.fallbackError, /Supadata API key is invalid/);
});

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

test("a fetched transcript is cached and reused without touching the page", async () => {
  const first = loadTranscriptHelpers();
  const fetched = await first.helpers.handleFetchTranscript("abc123XYZ");
  assert.equal(fetched.success, true);

  const entry = first.store.transcript_abc123XYZ;
  assert.ok(entry, "the successful transcript should be stored");
  assert.equal(entry.result.transcript.length, 2);
  assert.equal(typeof entry.savedAt, "number");
  // The cached copy must not carry the flag that marks a cache hit.
  assert.equal(entry.result.fromCache, undefined);

  const second = loadTranscriptHelpers({
    storage: { transcript_abc123XYZ: entry },
  });
  const reused = await second.helpers.handleFetchTranscript("abc123XYZ");

  assert.equal(reused.success, true);
  assert.equal(reused.fromCache, true);
  assert.deepEqual(plain(reused.transcript), plain(fetched.transcript));
  // The page was never asked on the second visit.
  assert.deepEqual(second.calls.tabMessages, []);
});

test("an expired cache entry is dropped and refetched", async () => {
  const stale = {
    savedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
    result: { success: true, transcript: [{ text: "old", start: 0 }] },
  };
  const { helpers, store, calls } = loadTranscriptHelpers({
    storage: { transcript_abc123XYZ: stale },
  });

  const result = await helpers.handleFetchTranscript("abc123XYZ");

  assert.equal(result.fromCache, undefined);
  assert.equal(result.transcript[0].text, "Welcome back");
  assert.equal(calls.tabMessages.length, 1);
  assert.notEqual(store.transcript_abc123XYZ.savedAt, stale.savedAt);
});

test("a failed fetch is never cached", async () => {
  const { helpers, store } = loadTranscriptHelpers({
    contentResponse: NO_CAPTIONS_RESPONSE,
  });

  await helpers.handleFetchTranscript("abc123XYZ");

  assert.equal(store.transcript_abc123XYZ, undefined);
});

test("the cache keeps only the ten most recent transcripts", async () => {
  const storage = {};
  for (let i = 0; i < 12; i += 1) {
    storage[`transcript_old${i}`] = {
      savedAt: 1000 + i,
      result: { success: true, transcript: [{ text: "x", start: 0 }] },
    };
  }
  const { helpers, store } = loadTranscriptHelpers({ storage });

  await helpers.handleFetchTranscript("abc123XYZ");

  const kept = Object.keys(store).filter((key) => key.startsWith("transcript_"));
  assert.equal(kept.length, 10);
  assert.ok(kept.includes("transcript_abc123XYZ"));
  // The oldest entries go first.
  assert.ok(!kept.includes("transcript_old0"));
  assert.ok(kept.includes("transcript_old11"));
});

// ---------------------------------------------------------------------------
// Content-script row discovery
// ---------------------------------------------------------------------------

/**
 * Minimal element stub covering what findTranscriptRows touches: "*" queries,
 * firstElementChild, textContent, parentElement, and closest.
 */
function makeElement(tag, { attrs = {}, text = "", children = [] } = {}) {
  const element = {
    tagName: tag.toUpperCase(),
    attrs,
    children,
    parentElement: null,
    get firstElementChild() {
      return children[0] ?? null;
    },
    get textContent() {
      return children.length
        ? children.map((child) => child.textContent).join("")
        : text;
    },
    descendants() {
      return children.flatMap((child) => [child, ...child.descendants()]);
    },
    querySelectorAll(selector) {
      return selector === "*" ? element.descendants() : [];
    },
    closest(selector) {
      const wanted = selector.split(",").map((part) => part.trim());
      let node = element;
      while (node) {
        if (wanted.includes(node.tagName.toLowerCase())) return node;
        node = node.parentElement;
      }
      return null;
    },
  };
  for (const child of children) child.parentElement = element;
  return element;
}

function makeRow(tag, time, text) {
  return makeElement(tag, {
    children: [
      makeElement("span", { text: time }),
      makeElement("span", { text }),
    ],
  });
}

function makeDocument(body) {
  const stubNode = () => ({
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {},
    getAttribute: () => null,
    appendChild() {},
    remove() {},
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    set textContent(_value) {},
    get textContent() {
      return "";
    },
    set innerHTML(_value) {},
  });
  return {
    body,
    head: stubNode(),
    documentElement: stubNode(),
    readyState: "complete",
    addEventListener() {},
    createElement: stubNode,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: (selector) => (selector === "*" ? body.descendants() : []),
  };
}

/** Boots content.js with a swappable document stub. */
function loadContentHelpers() {
  const listeners = { addListener() {} };
  const sandbox = {
    console,
    URL,
    CustomEvent: class {},
    Event: class {},
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    fetch: () => Promise.reject(new Error("no network in tests")),
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    getComputedStyle: () => ({
      display: "block",
      visibility: "visible",
      overflowY: "visible",
    }),
    location: {
      href: "https://www.youtube.com/watch?v=abc123XYZ",
      origin: "https://www.youtube.com",
      pathname: "/watch",
      search: "?v=abc123XYZ",
    },
    document: makeDocument(makeElement("div")),
    chrome: {
      runtime: {
        onMessage: listeners,
        sendMessage: () => Promise.resolve({}),
        getURL: (resourcePath) => `chrome-extension://test/${resourcePath}`,
      },
    },
  };
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  sandbox.dispatchEvent = () => true;
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.runInNewContext(read("content.js"), sandbox);
  return sandbox;
}

function countRows(sandbox, body) {
  sandbox.document = makeDocument(body);
  return sandbox.__YTD_CONTENT_TRANSCRIPT_TESTING__.findTranscriptRows().length;
}

test("transcript rows are found even when YouTube renames the element", () => {
  const sandbox = loadContentHelpers();
  const list = makeElement("div", {
    children: [
      makeRow("yt-transcript-segment-view-model", "19:21", "a reliability shift"),
      makeRow("yt-transcript-segment-view-model", "19:30", "users as possible"),
      makeRow("yt-transcript-segment-view-model", "19:38", "it was a pleasure"),
    ],
  });

  assert.equal(countRows(sandbox, list), 3);
});

test("a hidden panel does not hide rows rendered somewhere else", () => {
  const sandbox = loadContentHelpers();
  // The element carrying the transcript target-id can sit empty and hidden
  // while a different container renders the real rows.
  const body = makeElement("div", {
    children: [
      makeElement("ytd-engagement-panel-section-list-renderer", {
        attrs: { "target-id": "engagement-panel-searchable-transcript" },
      }),
      makeElement("div", {
        children: [
          makeRow("yt-transcript-segment-view-model", "0:05", "first line"),
          makeRow("yt-transcript-segment-view-model", "0:11", "second line"),
          makeRow("yt-transcript-segment-view-model", "0:19", "third line"),
          makeRow("yt-transcript-segment-view-model", "0:24", "fourth line"),
        ],
      }),
    ],
  });

  assert.equal(countRows(sandbox, body), 4);
});

test("player and sidebar timestamps are not mistaken for a transcript", () => {
  const sandbox = loadContentHelpers();
  const body = makeElement("div", {
    children: [
      makeElement("div", {
        children: [
          makeRow("ytd-compact-video-renderer", "24:29", "Some related video"),
        ],
      }),
      makeElement("div", {
        children: [
          makeRow("div", "1:02", "another related video"),
          makeRow("div", "3:44", "yet another related video"),
        ],
      }),
    ],
  });

  // Two loose rows are a sidebar, not a transcript: the finder needs three.
  assert.equal(countRows(sandbox, body), 0);
});

test("an empty page yields no rows rather than throwing", () => {
  const sandbox = loadContentHelpers();
  assert.equal(countRows(sandbox, makeElement("div")), 0);
});

test("caption tracks prefer human-written English", () => {
  const { pickCaptionTrack } =
    loadContentHelpers().__YTD_CONTENT_TRANSCRIPT_TESTING__;

  assert.deepEqual(
    pickCaptionTrack([
      { languageCode: "es", kind: "" },
      { languageCode: "en", kind: "asr" },
      { languageCode: "en", kind: "" },
    ]),
    { languageCode: "en", kind: "" },
  );

  // English auto-captions still beat another language's human track.
  assert.deepEqual(
    pickCaptionTrack([
      { languageCode: "es", kind: "" },
      { languageCode: "en-GB", kind: "asr" },
    ]),
    { languageCode: "en-GB", kind: "asr" },
  );

  // With no English at all, a human track beats an auto one.
  assert.deepEqual(
    pickCaptionTrack([
      { languageCode: "ja", kind: "asr" },
      { languageCode: "es", kind: "" },
    ]),
    { languageCode: "es", kind: "" },
  );
});
