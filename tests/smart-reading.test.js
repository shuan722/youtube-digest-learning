const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const panelSource = fs.readFileSync(
  path.resolve(__dirname, "..", "sidepanel.js"),
  "utf8",
);
const backgroundSource = fs.readFileSync(
  path.resolve(__dirname, "..", "background.js"),
  "utf8",
);

test("smart reading never fires a DeepSeek request on its own", () => {
  // Opening a video, reloading the panel, and switching intensity must all be
  // free. Only the button may spend tokens.
  assert.doesNotMatch(
    panelSource,
    /runSmartReading\(\{\s*automatic/,
    "the automatic trigger must be gone",
  );
  assert.doesNotMatch(
    panelSource,
    /automatic\s*=\s*false/,
    "runSmartReading must no longer branch on an automatic mode",
  );

  const restoreCalls = panelSource.match(/void loadCachedSmartReading\(\);/g);
  assert.equal(
    restoreCalls?.length,
    2,
    "both video-load paths must restore from cache instead of analyzing",
  );
  assert.match(
    panelSource,
    /getElementById\("learningIntensity"\)\s*\?\.addEventListener\("change", \(\) => loadCachedSmartReading\(\)\)/,
    "changing intensity must only re-read the cache",
  );

  // loadCachedSmartReading may read storage but must never reach the provider.
  const restore = panelSource.match(
    /async function loadCachedSmartReading\(\)[\s\S]*?\n}/,
  )[0];
  assert.doesNotMatch(restore, /sendMessage/);
  assert.match(restore, /chrome\.storage\.local\.get\(cacheKey\)/);

  // The single remaining request site is the button handler, and it always
  // reports failures now that no silent automatic run can hide them.
  const run = panelSource.match(/async function runSmartReading\(\)[\s\S]*?\n}/)[0];
  assert.match(run, /action: "analyzeLearningItems"/);
  assert.match(run, /catch \(error\) \{[\s\S]*?alert\(error\.message\);/);
});

test("learning analysis has token headroom and consumes finish_reason", () => {
  const handler = backgroundSource.match(
    /async function handleAnalyzeLearningItems\([\s\S]*?\n}/,
  )[0];
  assert.match(handler, /maxTokens: 12000/);
  assert.doesNotMatch(handler, /maxTokens: 6000/);
  assert.match(handler, /finishReason === "length"/);
  assert.match(
    backgroundSource,
    /finishReason: data\.choices\?\.\[0\]\?\.finish_reason/,
    "the provider helper must expose finish_reason to callers",
  );
});

test("a response truncated by max_tokens keeps the items that arrived", () => {
  // Loaded in this realm so the parsed values stay comparable with assert/strict.
  const { parseLooseJson, salvageTruncatedJson } = new Function(
    `${backgroundSource.match(/function parseLooseJson[\s\S]*?\n}/)[0]}
     ${backgroundSource.match(/function salvageTruncatedJson[\s\S]*?\n}/)[0]}
     return { parseLooseJson, salvageTruncatedJson };`,
  )();

  const complete = JSON.stringify({
    items: [
      { term: "hedge", example: 'she said "no [maybe]"', meaningZh: "含糊其辞" },
      { term: "double down", example: "path C:\\dir", meaningZh: "加倍投入" },
      { term: "prehistoric", example: "third", meaningZh: "史前的" },
    ],
    guide: { topicZh: "话题", ideas: ["一", "二"] },
  });

  // Cut inside the last item, the way max_tokens truncates a real answer.
  const truncated = complete.slice(0, complete.indexOf("prehistoric") + 6);
  const recovered = parseLooseJson(truncated);
  assert.deepEqual(
    recovered.items.map((item) => item.term),
    ["hedge", "double down"],
  );
  assert.deepEqual(recovered.guide, undefined);

  // Quotes and brackets inside strings must not be read as structure.
  const insideString = complete.slice(0, complete.indexOf("[maybe]") + 3);
  assert.equal(salvageTruncatedJson(insideString), null);

  // Intact responses must still parse untouched.
  assert.equal(parseLooseJson(complete).items.length, 3);
  assert.equal(parseLooseJson('```json\n{"a":1,}\n```').a, 1);
});
