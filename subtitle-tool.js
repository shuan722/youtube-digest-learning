/**
 * SUBTITLE TOOL
 *
 * Standalone page: upload a yt-dlp .srt file, reuse the extension's own
 * transcript segmentation strategy (transcript-grouping.js) to rebuild
 * sentence-level paragraphs, translate them with Chrome's built-in
 * Translator (translator.js, same module the side panel uses), then export.
 *
 * Deliberately independent of sidepanel.js: it does not touch currentVideoId,
 * chrome.storage caches, or any YouTube-tab state, so it works as a plain
 * extension page with no side-panel gating.
 */

window.addEventListener("pagehide", () => YTD_TRANSLATOR.dispose());

// ============================================================
// STATE
// ============================================================

let segments = []; // [{ id, start, text }]
let translations = new Map(); // id -> translated text
let sourceTitle = "subtitle";
let lastEndSeconds = 0;

const BATCH_SIZE = 5;

const BROWSER_TRANSLATION_ERRORS = {
  UNSUPPORTED:
    "Chrome's built-in translator is unavailable here. Update Chrome (138+) to use this tool.",
  MODEL_NOT_READY: "Chrome is still downloading its translation model. Retry in a moment.",
  SAME_LANGUAGE: "This transcript is already in Chinese.",
};

// ============================================================
// SRT PARSING (mirrors segment_transcript.py's parse_srt)
// ============================================================

const TIMESTAMP_RE =
  /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/;

function timestampToSeconds(h, m, s, ms) {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

function parseSrt(text) {
  const normalized = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const blocks = normalized.trim().split(/\n\n+/);
  const entries = [];

  blocks.forEach((block) => {
    const lines = block.split("\n").filter((line) => line.trim() !== "");
    if (!lines.length) return;
    const tsLineIndex = lines.findIndex((line) => TIMESTAMP_RE.test(line));
    if (tsLineIndex === -1) return;
    const match = TIMESTAMP_RE.exec(lines[tsLineIndex]);
    const start = timestampToSeconds(match[1], match[2], match[3], match[4]);
    const end = timestampToSeconds(match[5], match[6], match[7], match[8]);
    const text = lines.slice(tsLineIndex + 1).join(" ").trim();
    if (!text) return;
    entries.push({ start, duration: Math.max(0, end - start), end, text });
  });

  return entries;
}

// ============================================================
// HELPERS (small duplicates of sidepanel.js's, kept local so this page has
// zero dependency on sidepanel.js's state machine)
// ============================================================

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

function sanitizeFilename(str) {
  return (str || "untitled")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 50)
    .toLowerCase();
}

function downloadFile(text, filename, mimeType) {
  const blob = new Blob([text], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatTimestamp(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function srtTimestamp(seconds) {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

// ============================================================
// STEP 1: UPLOAD + PARSE
// ============================================================

const fileInput = document.getElementById("srtFileInput");
const filePickerLabel = document.getElementById("filePickerLabel");
const parseStatus = document.getElementById("parseStatus");
const translateSection = document.getElementById("translateSection");
const previewSection = document.getElementById("previewSection");
const exportSection = document.getElementById("exportSection");
const previewList = document.getElementById("previewList");

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  filePickerLabel.textContent = file.name;
  sourceTitle = file.name.replace(/\.srt$/i, "");
  translations = new Map();

  try {
    const text = await file.text();
    const entries = parseSrt(text);
    if (!entries.length) {
      parseStatus.textContent = "未能从该文件中解析出任何字幕条目，请确认这是有效的 .srt 文件。";
      return;
    }
    lastEndSeconds = entries[entries.length - 1].end;
    segments = groupTranscriptEntries(entries);
    parseStatus.textContent = `解析完成：${entries.length} 条原始字幕 → ${segments.length} 段。`;
    translateSection.hidden = false;
    previewSection.hidden = false;
    exportSection.hidden = false;
    renderPreview();
  } catch (error) {
    parseStatus.textContent = `解析失败：${error.message || error}`;
  }
});

// ============================================================
// STEP 2: TRANSLATE
// ============================================================

const translateBtn = document.getElementById("translateBtn");
const translateStatus = document.getElementById("translateStatus");
const progressTrack = document.getElementById("progressTrack");
const progressFill = document.getElementById("progressFill");
const sourceLanguageSelect = document.getElementById("sourceLanguage");

translateBtn.addEventListener("click", async () => {
  if (!segments.length) return;
  if (!YTD_TRANSLATOR.isSupported()) {
    translateStatus.textContent = BROWSER_TRANSLATION_ERRORS.UNSUPPORTED;
    return;
  }

  translateBtn.disabled = true;
  progressTrack.hidden = false;
  progressFill.style.width = "0%";
  let done = 0;

  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE).map(({ id, text }) => ({ id, text }));
    const result = await YTD_TRANSLATOR.translateSegments(batch, {
      sourceLanguage: sourceLanguageSelect.value,
      onDownloadProgress: () => {
        translateStatus.textContent = "正在下载 Chrome 翻译模型…";
      },
    });

    if (!result.success) {
      translateStatus.textContent =
        BROWSER_TRANSLATION_ERRORS[result.error] || `翻译失败：${result.error}`;
      translateBtn.disabled = false;
      return;
    }

    (result.translatedContent?.segments || []).forEach((item) => {
      if (item?.id) translations.set(item.id, item.text || "");
    });

    done += batch.length;
    progressFill.style.width = `${Math.round((done / segments.length) * 100)}%`;
    translateStatus.textContent = `已翻译 ${Math.min(done, segments.length)}/${segments.length} 段`;
    renderPreview();
  }

  translateBtn.disabled = false;
  translateStatus.textContent = `翻译完成：${segments.length}/${segments.length} 段`;
});

// ============================================================
// STEP 3: PREVIEW
// ============================================================

function renderPreview() {
  previewList.innerHTML = segments
    .map((segment) => {
      const translated = translations.get(segment.id);
      const translationHtml = translated
        ? `<p class="translation">${escapeHtml(translated)}</p>`
        : `<p class="translation pending">尚未翻译</p>`;
      return `<div class="preview-row">
        <div class="time">${formatTimestamp(segment.start)}</div>
        <div>
          <p class="original">${escapeHtml(segment.text)}</p>
          ${translationHtml}
        </div>
      </div>`;
    })
    .join("");
}

// ============================================================
// STEP 4: EXPORT
// ============================================================

const exportBtn = document.getElementById("exportBtn");
const exportLanguageSelect = document.getElementById("exportLanguage");
const exportFormatSelect = document.getElementById("exportFormat");
const exportTimestampsCheckbox = document.getElementById("exportTimestamps");

function getExportRows() {
  return segments.map((segment) => ({
    timestamp: formatTimestamp(segment.start),
    start: segment.start,
    original: segment.text,
    translated: translations.get(segment.id) || "",
  }));
}

exportBtn.addEventListener("click", () => {
  if (!segments.length) return;
  const language = exportLanguageSelect.value;
  const format = exportFormatSelect.value;
  const withTimestamps = exportTimestampsCheckbox.checked;
  const rows = getExportRows();

  if (format === "json") {
    exportTranscriptJson(rows);
    return;
  }

  if (language !== "original" && rows.some((row) => !row.translated)) {
    alert("还有段落未翻译完成，请先在第 2 步完成翻译，或改选“英文 / 原文”导出。");
    return;
  }

  const lineText = (row) => {
    const stamp = withTimestamps ? `[${row.timestamp}] ` : "";
    if (language === "zh") return `${stamp}${row.translated}`;
    if (language === "bilingual") return `${stamp}${row.original}\n${row.translated}`;
    return `${stamp}${row.original}`;
  };
  const suffix = language === "bilingual" ? "-bilingual" : language === "zh" ? "-zh" : "-original";

  if (format === "srt") {
    const lines = [];
    rows.forEach((row, index) => {
      const start = row.start;
      const end = index + 1 < rows.length ? rows[index + 1].start : lastEndSeconds || start + 3;
      const body =
        language === "zh"
          ? row.translated
          : language === "bilingual"
            ? `${row.original}\n${row.translated}`
            : row.original;
      lines.push(String(index + 1), `${srtTimestamp(start)} --> ${srtTimestamp(Math.max(end, start + 0.1))}`, body, "");
    });
    downloadFile(lines.join("\n"), `${sanitizeFilename(sourceTitle)}${suffix}.srt`, "text/plain");
    return;
  }

  if (format === "html" || format === "pdf") {
    const html = buildExportHtml(rows, language, withTimestamps);
    if (format === "pdf") {
      printHtmlAsPdf(html);
    } else {
      downloadFile(html, `${sanitizeFilename(sourceTitle)}${suffix}.html`, "text/html");
    }
    return;
  }

  const heading = format === "md" ? `# ${sourceTitle}\n\n` : `${sourceTitle}\n\n`;
  const output = heading + rows.map(lineText).join("\n\n");
  downloadFile(output, `${sanitizeFilename(sourceTitle)}${suffix}.${format}`, "text/plain");
});

function buildExportHtml(rows, language, withTimestamps) {
  const body = rows
    .map(
      (row) => `<section class="line"><div class="time">${withTimestamps ? escapeHtml(row.timestamp) : ""}</div><div>${language !== "zh" ? `<p class="original">${escapeHtml(row.original)}</p>` : ""}${language !== "original" ? `<p class="translation">${escapeHtml(row.translated)}</p>` : ""}</div></section>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(sourceTitle)}</title><style>@page{margin:18mm}body{font:11pt/1.6 Georgia,serif;color:#24211d;max-width:800px;margin:auto}h1{font:700 24pt Arial,sans-serif}.line{display:grid;grid-template-columns:52px 1fr;gap:12px;padding:10px 0;border-bottom:1px solid #eee;break-inside:avoid}.time{color:#c8674f;font:9pt Arial}.original,.translation{margin:0}.translation{margin-top:5px;color:#4e4942}@media print{body{max-width:none}}</style></head><body><h1>${escapeHtml(sourceTitle)}</h1>${body}</body></html>`;
}

/**
 * Chrome extension pages cannot generate a real PDF file directly, so the
 * HTML is opened in a plain window and handed to the browser's native print
 * dialog, where "Save as PDF" produces the file. Mirrors sidepanel.js's
 * exportIntensiveReading printAsPdf path.
 */
function printHtmlAsPdf(html) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Chrome 阻止了打印窗口。请允许弹出式窗口后重试。");
    return;
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.addEventListener(
    "load",
    () => setTimeout(() => printWindow.print(), 250),
    { once: true },
  );
}

/**
 * Structured JSON export for a downstream agent (e.g. a blog-writing skill).
 * Mirrors the shape sidepanel.js's exportTranscriptJson produces, minus the
 * fields an uploaded local file has no way to know (videoId, author,
 * publishedAt — there is no live YouTube page to read them from here).
 * Ignores the language dropdown: always includes original text plus
 * whatever translation exists, so it never blocks on "not translated yet".
 */
function exportTranscriptJson(rows) {
  const payload = {
    videoId: null,
    title: sourceTitle,
    author: "",
    publishedAt: "",
    durationSeconds: Math.round(lastEndSeconds || 0),
    transcriptSource: "yt-dlp-srt",
    translationLanguage: rows.some((row) => row.translated) ? "zh-Hans" : null,
    transcript: rows.map((row) => ({
      startMs: Math.round((row.start || 0) * 1000),
      time: row.timestamp,
      text: row.original,
      textZh: row.translated || "",
    })),
  };
  downloadFile(
    JSON.stringify(payload, null, 2),
    `${sanitizeFilename(sourceTitle)}-transcript.json`,
    "application/json",
  );
}

// Pure helpers exposed for Node tests, mirroring sidepanel.js's testing hook.
if (typeof globalThis !== "undefined") {
  globalThis.__YTD_SUBTITLE_TOOL_TESTING__ = { parseSrt, srtTimestamp, formatTimestamp };
}
