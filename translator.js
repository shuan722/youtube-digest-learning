/**
 * BROWSER TRANSLATION
 *
 * Wraps Chrome's built-in Translator API, which runs a downloaded model on the
 * device. It is free and offline, so it is the default source for transcript
 * translation; DeepSeek stays available for people who prefer its wording.
 *
 * Availability: Chrome 138 or newer, on a profile where the language pack can
 * be downloaded. Callers must handle isSupported() being false rather than
 * assuming a translation will arrive.
 *
 * This file answers with the same shape the DeepSeek path returns:
 *
 *   { success: true, translatedContent: { segments: [{ id, text }] } }
 *
 * so the side panel's alignment, caching, and retry logic never learn which
 * translator produced a line.
 */
var YTD_TRANSLATOR = (() => {
  const TARGET_LANGUAGE = "zh-Hans";
  const DEFAULT_SOURCE_LANGUAGE = "en";

  // Chrome caps how many translator instances may exist at once, so one is
  // kept and reused until the language pair changes or the page goes away.
  let cached = null;
  let cachedPair = "";
  let initPromise = null;

  function translatorApi() {
    return typeof self !== "undefined" && self.Translator ? self.Translator : null;
  }

  function isSupported() {
    return translatorApi() !== null;
  }

  /** "en-GB" and "en_US" both describe the "en" model. */
  function baseLanguage(code) {
    return String(code || "")
      .trim()
      .toLowerCase()
      .split(/[-_]/)[0];
  }

  function dispose() {
    try {
      cached?.destroy?.();
    } catch (error) {
      // Teardown errors are not actionable.
    }
    cached = null;
    cachedPair = "";
    initPromise = null;
  }

  function createTranslator(api, sourceLanguage, onDownloadProgress) {
    return api
      .create({
        sourceLanguage,
        targetLanguage: TARGET_LANGUAGE,
        monitor(monitor) {
          monitor.addEventListener("downloadprogress", (event) => {
            if (typeof event?.loaded === "number") onDownloadProgress(event.loaded);
          });
        },
      })
      .then((translator) => {
        cached = translator;
        cachedPair = `${sourceLanguage}->${TARGET_LANGUAGE}`;
        return translator;
      });
  }

  async function ensureTranslator(sourceLanguage, onDownloadProgress) {
    const pair = `${sourceLanguage}->${TARGET_LANGUAGE}`;
    if (cached && cachedPair === pair) return cached;
    if (cached) dispose();
    if (initPromise) return initPromise;

    const api = translatorApi();
    if (!api) throw new Error("UNSUPPORTED");

    const availability = await api.availability({
      sourceLanguage,
      targetLanguage: TARGET_LANGUAGE,
    });
    if (availability === "unavailable") throw new Error("UNSUPPORTED");
    // The model is not on disk yet. Report the download immediately so the UI
    // shows progress instead of looking stalled while create() waits.
    if (availability !== "available") onDownloadProgress(0);

    initPromise = createTranslator(api, sourceLanguage, onDownloadProgress).catch(
      () => {
        // A first create() can fail on a transient download hiccup or a stale
        // instance from an earlier attempt. Drop it and try once more.
        dispose();
        return createTranslator(api, sourceLanguage, onDownloadProgress).catch(
          () => {
            dispose();
            throw new Error("MODEL_NOT_READY");
          },
        );
      },
    );

    return initPromise;
  }

  /**
   * Chrome's Translator collapses line breaks when a whole block is sent at
   * once, so each line goes separately and the structure is rebuilt after.
   */
  async function translateText(translator, text) {
    const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
    const translated = [];
    for (const line of lines) {
      const content = line.trim();
      translated.push(content ? (await translator.translate(content)).trim() : "");
    }
    return translated.join("\n").trim();
  }

  /**
   * Translates one batch of transcript segments on the device.
   *
   * @param {Array} segments - [{ id, text }]
   * @param {Object} options - { sourceLanguage, onDownloadProgress }
   * @returns {Object} - { success, translatedContent } or { success: false, error }
   */
  async function translateSegments(segments, options = {}) {
    const list = Array.isArray(segments) ? segments : [];
    const onDownloadProgress =
      typeof options.onDownloadProgress === "function"
        ? options.onDownloadProgress
        : () => {};
    const source =
      baseLanguage(options.sourceLanguage) || DEFAULT_SOURCE_LANGUAGE;

    // Nothing to do when the transcript is already in the target language.
    if (source === baseLanguage(TARGET_LANGUAGE)) {
      return { success: false, error: "SAME_LANGUAGE" };
    }

    try {
      const translator = await ensureTranslator(source, onDownloadProgress);
      const translatedSegments = [];
      for (const segment of list) {
        const text = String(segment?.text || "").trim();
        translatedSegments.push({
          id: segment?.id,
          text: text ? await translateText(translator, text) : "",
        });
      }
      return { success: true, translatedContent: { segments: translatedSegments } };
    } catch (error) {
      // A failed instance must not be reused by the next batch.
      if (error?.message !== "UNSUPPORTED") dispose();
      return { success: false, error: error?.message || "TRANSLATION_FAILED" };
    }
  }

  return {
    TARGET_LANGUAGE,
    DEFAULT_SOURCE_LANGUAGE,
    isSupported,
    baseLanguage,
    dispose,
    translateSegments,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_TRANSLATOR;
}
