const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const settings = require("../settings.js");

// Values built inside a vm context carry that context's prototypes, which
// deepStrictEqual rejects. Compare their plain serialized form instead.
const plain = (value) => JSON.parse(JSON.stringify(value));

/**
 * Loads translator.js against a fake Chrome Translator API.
 *
 * @param {Object} options - availability, translate, and create behavior
 */
function loadTranslator({
  availability = "available",
  translate = async (text) => `zh(${text})`,
  createFailures = 0,
  present = true,
} = {}) {
  const calls = { availability: [], create: [], translate: [], destroy: 0 };
  let remainingFailures = createFailures;

  const Translator = {
    availability: async (options) => {
      calls.availability.push(options);
      return availability;
    },
    create: async (options) => {
      calls.create.push(options);
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        throw new Error("transient create failure");
      }
      if (options.monitor) {
        options.monitor({
          addEventListener: (name, handler) => {
            if (name === "downloadprogress") handler({ loaded: 0.5 });
          },
        });
      }
      return {
        translate: async (text) => {
          calls.translate.push(text);
          return translate(text);
        },
        destroy: () => {
          calls.destroy += 1;
        },
      };
    },
  };

  const sandbox = { console };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  if (present) sandbox.Translator = Translator;
  vm.runInNewContext(read("translator.js"), sandbox);
  return { translator: sandbox.YTD_TRANSLATOR, calls };
}

test("the browser translator is the default and the setting is strict", () => {
  assert.equal(settings.DEFAULTS.translationProvider, "browser");
  assert.equal(settings.normalize({}).translationProvider, "browser");
  assert.equal(
    settings.normalize({ translationProvider: "ai" }).translationProvider,
    "ai",
  );
  // Anything unrecognized falls back to the free on-device path.
  assert.equal(
    settings.normalize({ translationProvider: "google" }).translationProvider,
    "browser",
  );
});

test("segments translate into the same shape the AI path returns", async () => {
  const { translator, calls } = loadTranslator();

  const result = await translator.translateSegments(
    [
      { id: "s1", text: "Hello there" },
      { id: "s2", text: "Second line" },
    ],
    { sourceLanguage: "en" },
  );

  assert.equal(result.success, true);
  assert.deepEqual(plain(result.translatedContent.segments), [
    { id: "s1", text: "zh(Hello there)" },
    { id: "s2", text: "zh(Second line)" },
  ]);
  assert.deepEqual(plain(calls.availability[0]), {
    sourceLanguage: "en",
    targetLanguage: "zh-Hans",
  });
});

test("a regional source code resolves to its base model", async () => {
  const { translator, calls } = loadTranslator();

  await translator.translateSegments([{ id: "s1", text: "Hi" }], {
    sourceLanguage: "en-GB",
  });

  assert.equal(calls.availability[0].sourceLanguage, "en");
  assert.equal(calls.create[0].sourceLanguage, "en");
});

test("one translator instance is reused across batches", async () => {
  const { translator, calls } = loadTranslator();

  await translator.translateSegments([{ id: "a", text: "one" }], {
    sourceLanguage: "en",
  });
  await translator.translateSegments([{ id: "b", text: "two" }], {
    sourceLanguage: "en",
  });

  // Chrome caps live instances, so the second batch must not create another.
  assert.equal(calls.create.length, 1);
  assert.equal(calls.translate.length, 2);
});

test("line breaks survive translation", async () => {
  // Chrome's Translator collapses newlines when a block is sent at once, so
  // each line goes separately and the structure is rebuilt afterwards.
  const { translator, calls } = loadTranslator();

  const result = await translator.translateSegments(
    [{ id: "s1", text: "First line\n\nThird line" }],
    { sourceLanguage: "en" },
  );

  assert.deepEqual(calls.translate, ["First line", "Third line"]);
  assert.equal(
    result.translatedContent.segments[0].text,
    "zh(First line)\n\nzh(Third line)",
  );
});

test("a transcript already in Chinese is not translated", async () => {
  const { translator, calls } = loadTranslator();

  const result = await translator.translateSegments([{ id: "s1", text: "你好" }], {
    sourceLanguage: "zh-Hans",
  });

  assert.equal(result.success, false);
  assert.equal(result.error, "SAME_LANGUAGE");
  assert.deepEqual(calls.create, []);
});

test("a missing or unavailable API reports UNSUPPORTED", async () => {
  const missing = loadTranslator({ present: false });
  assert.equal(missing.translator.isSupported(), false);
  const missingResult = await missing.translator.translateSegments(
    [{ id: "s1", text: "Hi" }],
    { sourceLanguage: "en" },
  );
  assert.equal(missingResult.error, "UNSUPPORTED");

  const unavailable = loadTranslator({ availability: "unavailable" });
  assert.equal(unavailable.translator.isSupported(), true);
  const unavailableResult = await unavailable.translator.translateSegments(
    [{ id: "s1", text: "Hi" }],
    { sourceLanguage: "en" },
  );
  assert.equal(unavailableResult.error, "UNSUPPORTED");
  assert.deepEqual(unavailable.calls.create, []);
});

test("a downloadable model reports progress and retries a failed create", async () => {
  const progress = [];
  const { translator, calls } = loadTranslator({
    availability: "downloadable",
    createFailures: 1,
  });

  const result = await translator.translateSegments(
    [{ id: "s1", text: "Hi" }],
    { sourceLanguage: "en", onDownloadProgress: (loaded) => progress.push(loaded) },
  );

  assert.equal(result.success, true);
  // Two create() calls: the first failed transiently, the second succeeded.
  assert.equal(calls.create.length, 2);
  // Progress fires immediately so the UI does not look stalled.
  assert.ok(progress.includes(0));
  assert.ok(progress.includes(0.5));
});

test("a create that never succeeds reports MODEL_NOT_READY", async () => {
  const { translator } = loadTranslator({
    availability: "downloadable",
    createFailures: 5,
  });

  const result = await translator.translateSegments([{ id: "s1", text: "Hi" }], {
    sourceLanguage: "en",
  });

  assert.equal(result.success, false);
  assert.equal(result.error, "MODEL_NOT_READY");
});

test("the side panel never falls back to the paid path on its own", () => {
  const sidepanel = read("sidepanel.js");
  const browserBranch = sidepanel.slice(
    sidepanel.indexOf("async function translateSegmentBatch"),
    sidepanel.indexOf("async function requestTranscriptTranslationBatch"),
  );

  assert.ok(browserBranch.length > 0, "translateSegmentBatch should exist");
  // Spending tokens after a free translation fails would defeat the default.
  const aiCallIndex = browserBranch.indexOf("sendTranslationMessage");
  const providerCheckIndex = browserBranch.indexOf(
    'currentTranslationProvider === "browser"',
  );
  assert.ok(providerCheckIndex >= 0);
  assert.ok(
    aiCallIndex > providerCheckIndex,
    "the AI request must sit outside the browser branch",
  );
  assert.ok(browserBranch.includes("BROWSER_TRANSLATION_ERRORS"));
});
