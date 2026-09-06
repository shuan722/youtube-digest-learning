/**
 * CONTENT SCRIPT
 *
 * This script runs ON the YouTube page itself. It can see and modify
 * the YouTube page DOM (the HTML elements).
 *
 * It handles:
 * 1. Extracting video info (title, channel name) from the page
 * 2. Injecting "key moment" markers onto YouTube's progress bar
 * 3. Adding a "Digest" button to YouTube's action bar (next to Share/Save)
 *
 * Think of it like a robot sitting inside the YouTube tab,
 * reading the page and making small visual changes.
 */

const DEBUG = false;
const debugLog = (...args) => {
  if (DEBUG) console.log(...args);
};

// ============================================================
// GLOBAL STATE
// ============================================================

let ytdNoteButton = null;
let ytdNoteButtonTimer = null;
let ytdNoteKeyboardListenerAdded = false;
let ytdNoteButtonRetryTimer = null;
let ytdDigestButton = null;
let digestButtonObserver = null;
let digestButtonReconcileTimer = null;
let digestButtonResizeListenerAdded = false;
let inlineDigestContainer = null;
let compactDigestTimer = null;
let compactDigestSegments = [];
let compactDigestMode = "bilingual";
let compactDigestVideoId = "";
let compactDigestLastCacheRefresh = 0;
let compactDigestLoopIndex = -1;
let compactDigestLoopGapMs = 1500;
let compactDigestLoopWaiting = false;
let compactDigestLoopTimeout = null;

// ============================================================
// INITIALIZATION
// ============================================================

/**
 * When the page loads, inject our Digest button and Note button.
 * We wait a bit for YouTube's UI to fully render.
 */
function init() {
  // Register the global "n" keyboard shortcut once
  if (!ytdNoteKeyboardListenerAdded) {
    document.addEventListener("keydown", handleNoteKeyboardShortcut);
    ytdNoteKeyboardListenerAdded = true;
  }

  // Try to inject the buttons immediately
  injectDigestButton();
  tryInjectNoteButton();

  // Also set up an observer to handle YouTube's dynamic content loading
  // (YouTube is an SPA, so elements appear/disappear as you navigate)
  setupButtonObserver();
  setupDigestButtonResizeListener();
}

/**
 * Attempts to inject the note button. If the player container isn't ready yet,
 * retry a few times with a short delay. YouTube renders the player asynchronously
 * after navigation, so a single immediate attempt can miss it.
 */
function tryInjectNoteButton() {
  if (!window.location.pathname.includes("/watch")) return;

  // Clear any existing retry so we don't stack timers
  if (ytdNoteButtonRetryTimer) {
    clearInterval(ytdNoteButtonRetryTimer);
    ytdNoteButtonRetryTimer = null;
  }

  let attempts = 0;
  const maxAttempts = 30; // ~3 seconds of retrying

  function attempt() {
    attempts++;
    const playerContainer = document.querySelector(
      "#movie_player.html5-video-player, #movie_player, .html5-video-player",
    );

    if (playerContainer) {
      injectNoteButton();
      if (ytdNoteButtonRetryTimer) {
        clearInterval(ytdNoteButtonRetryTimer);
        ytdNoteButtonRetryTimer = null;
      }
      return;
    }

    if (attempts >= maxAttempts) {
      debugLog(
        "[YouTube Digest Content] Player container not found after retries, giving up",
      );
      if (ytdNoteButtonRetryTimer) {
        clearInterval(ytdNoteButtonRetryTimer);
        ytdNoteButtonRetryTimer = null;
      }
    }
  }

  attempt();
  if (!ytdNoteButton || !ytdNoteButton.isConnected) {
    ytdNoteButtonRetryTimer = setInterval(attempt, 100);
  }
}

// Run init when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// ============================================================
// MESSAGE HANDLING
// ============================================================

/**
 * Listen for messages from the side panel or background script.
 * When they ask for video info, we read it from the page.
 * When they send key moments, we highlight them on the progress bar.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  debugLog("[YouTube Digest Content] Received message:", message.action, message);

  if (message.action === "getVideoInfo") {
    // Read video title and channel name from the page
    const info = extractVideoInfo();
    debugLog("[YouTube Digest Content] Returning video info:", info);
    sendResponse(info);
    return false; // Synchronous response
  }

  if (message.action === "highlightMoments") {
    // Key moment markers disabled — chapters are shown in the side panel only.
    sendResponse({ success: true });
    return false;
  }

  if (message.action === "getCurrentTime") {
    // Return the current video playback time (used by auto-scroll)
    const video = document.querySelector("video.html5-main-video");
    sendResponse({
      currentTime: video ? Math.floor(video.currentTime) : 0,
      paused: video ? video.paused : true,
    });
    return false;
  }

  if (message.action === "seekTo") {
    // Jump the video to a specific timestamp
    debugLog("[YouTube Digest Content] Seeking to:", message.seconds);
    seekToTimestamp(message.seconds);
    sendResponse({ success: true });
    return false;
  }

  if (message.action === "showNoteSavedFeedback") {
    // Show brief feedback that note was saved
    showNoteSavedToast(message.note);
    sendResponse({ success: true });
    return false;
  }

  if (message.action === "extractTranscript") {
    // Reads YouTube's own captions and answers in Supadata's payload shape.
    extractTranscriptPayload()
      .then(sendResponse)
      .catch((error) =>
        sendResponse({
          success: false,
          error: "EXTRACTION_FAILED",
          message: error?.message || "Could not read this video's captions.",
        }),
      );
    return true; // Keep the channel open for the async response.
  }

  // Unknown action - still send a response to prevent hanging
  debugLog("[YouTube Digest Content] Unknown action:", message.action);
  sendResponse({ success: false, error: "Unknown action" });
  return false;
});

// ============================================================
// DIGEST BUTTON INJECTION
// ============================================================

/**
 * Injects a "Digest" button into YouTube's action bar.
 * The button appears next to Share, Save, etc. below the video.
 *
 * When clicked, it opens the YouTube Digest side panel.
 */
function isVisibleDigestHost(element) {
  if (!element || !element.isConnected) return false;

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

/**
 * YouTube keeps hidden copies of its responsive action toolbar in the DOM.
 * querySelector() can return one of those 0x0 copies before the toolbar the
 * viewer can actually see, so inspect every candidate and resolve the native
 * button group inside the visible action row for the current video.
 */
function findDigestButtonHost() {
  const primaryActionRows = Array.from(
    document.querySelectorAll("ytd-watch-metadata #actions-inner"),
  );

  for (const actionRow of primaryActionRows) {
    if (!isVisibleDigestHost(actionRow)) continue;

    const visibleButtonGroup = Array.from(
      actionRow.querySelectorAll("#top-level-buttons-computed"),
    ).find(isVisibleDigestHost);
    if (visibleButtonGroup) return visibleButtonGroup;
  }

  const fallbackCandidates = Array.from(
    document.querySelectorAll(
      "ytd-watch-metadata #actions #top-level-buttons-computed, " +
        "ytd-watch-metadata #top-level-buttons-computed, " +
        "#primary #actions #top-level-buttons-computed",
    ),
  );

  return (
    fallbackCandidates.find(
      (candidate) =>
        isVisibleDigestHost(candidate) &&
        (candidate.closest("ytd-watch-metadata") ||
          candidate.closest("#primary")),
    ) || null
  );
}

function createDigestButton() {
  const digestButton = document.createElement("button");
  digestButton.id = "ytd-digest-button";
  digestButton.type = "button";
  digestButton.setAttribute("aria-label", "Open YouTube Digest");
  digestButton.innerHTML = `
    <span class="ytd-digest-icon" style="font-size: 11px;">▶</span>
    <span class="ytd-digest-label">Digest</span>
  `;

  // Style the button — rounded pill in our terracotta accent, sized to sit
  // comfortably among YouTube's native action buttons.
  digestButton.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 0 18px;
    height: 36px;
    border: none;
    border-radius: 18px;
    background: #c8674f;
    color: white;
    font-family: "Roboto", "Arial", sans-serif;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    margin-right: 8px;
    transition: background 0.2s, transform 0.1s, box-shadow 0.2s;
    box-shadow: 0 2px 8px rgba(200, 103, 79, 0.3);
    flex: 0 0 auto;
    align-self: center;
    width: max-content;
    min-width: max-content;
    max-width: max-content;
    white-space: nowrap;
  `;

  // Hover effects
  digestButton.addEventListener("mouseenter", () => {
    digestButton.style.background = "#b25742";
    digestButton.style.transform = "scale(1.02)";
  });

  digestButton.addEventListener("mouseleave", () => {
    digestButton.style.background = "#c8674f";
    digestButton.style.transform = "scale(1)";
  });

  // Click handler — show the learning workspace below the video. Chrome's
  // native side panel cannot be repositioned, so the same extension page is
  // embedded in YouTube's watch layout instead.
  digestButton.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    debugLog("[YouTube Digest] Digest button clicked");

    toggleInlineDigest();
  });

  ytdDigestButton = digestButton;
  return digestButton;
}

async function toggleInlineDigest() {
  const existing = document.getElementById("ytd-digest-inline");
  if (existing) {
    stopCompactDigest();
    existing.remove();
    inlineDigestContainer = null;
    return;
  }

  const player = document.querySelector(
    "#movie_player.html5-video-player, #movie_player, .html5-video-player",
  );
  if (!player) {
    setTimeout(toggleInlineDigest, 300);
    return;
  }

  const container = document.createElement("section");
  container.id = "ytd-digest-inline";
  container.innerHTML = `
    <div class="ytd-digest-overlay-head"><span class="ytd-digest-overlay-status">正在读取学习缓存…</span><span class="ytd-digest-loop-controls" role="group" aria-label="句子循环跟读"><button type="button" data-loop-action="previous" title="上一句">‹</button><button type="button" data-loop-action="toggle" title="循环当前句">跟读</button><button type="button" data-loop-action="next" title="下一句">›</button><button type="button" data-loop-action="gap" title="切换跟读留白时间">留白 1.5s</button></span><span class="ytd-digest-overlay-modes" role="group" aria-label="字幕语言"><button type="button" data-mode="en">英文</button><button type="button" data-mode="bilingual">双语</button><button type="button" data-mode="zh">中文</button></span><button class="ytd-digest-inline-side" type="button">完整</button><button class="ytd-digest-inline-toggle" type="button">×</button></div>
    <button class="ytd-digest-overlay-line" type="button"><span class="ytd-digest-overlay-time">0:00</span><span class="ytd-digest-overlay-copy"><span class="ytd-digest-overlay-en">准备字幕…</span><span class="ytd-digest-overlay-zh"></span></span></button>
  `;
  player.appendChild(container);
  inlineDigestContainer = container;

  container.querySelector(".ytd-digest-inline-toggle").addEventListener("click", () => toggleInlineDigest());
  container.querySelector(".ytd-digest-inline-side").addEventListener("click", async () => {
    try {
      await chrome.runtime.sendMessage({ action: "openSidePanel" });
    } catch (error) {
      console.warn("[YouTube Digest] Could not open side panel:", error);
    }
  });
  container.querySelectorAll("[data-loop-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      handleCompactLoopAction(button.dataset.loopAction);
    });
  });
  const videoId = new URL(location.href).searchParams.get("v") || "";
  compactDigestVideoId = videoId;
  // A rejection here used to abort this function and freeze the overlay on its
  // placeholder text forever. Treat it like a cache miss and let the retry
  // timer recover: it happens whenever the extension is reloaded underneath a
  // still-open tab.
  let result = null;
  try {
    result = await chrome.runtime.sendMessage({ action: "getCompactTranscriptData", videoId });
  } catch (error) {
    console.warn("[YouTube Digest] Compact transcript unavailable:", error?.message);
  }
  if (!result?.success) {
    container.querySelector(".ytd-digest-overlay-status").textContent = "正在等待右侧字幕…";
    container.querySelector(".ytd-digest-overlay-en").textContent = "字幕生成后会自动显示，无需重新打开。";
    compactDigestTimer = setInterval(refreshCompactDigestCache, 1000);
    return;
  }
  const source = result.compactSegments?.length ? result.compactSegments : (result.transcript || []).map((item, index) => ({ id: `raw-${index}`, start: Number(item.start) || 0, text: item.text || "" }));
  compactDigestMode = result.displayMode || "bilingual";
  updateCompactModeButtons();
  container.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      compactDigestMode = button.dataset.mode;
      container.dataset.active = "";
      updateCompactModeButtons();
      renderCompactDigest();
      await chrome.runtime.sendMessage({ action: "setCompactDisplayMode", mode: compactDigestMode });
    });
  });
  const terms = [...(result.vocabulary || []), ...(result.learningItems || []).map((item) => item.term)];
  compactDigestSegments = source.map((item) => ({ ...item, translation: result.paragraphCache?.[`${videoId}:zh:semantic:${item.id}`] || "", terms }));
  container.querySelector(".ytd-digest-overlay-status").textContent = "跟随播放 · 复用精读缓存";
  renderCompactDigest();
  compactDigestTimer = setInterval(renderCompactDigest, 350);
}

function compactDigestHighlight(text, terms) {
  let html = escapeHtmlForContent(text);
  [...new Set(terms || [])].filter((term) => /^[A-Za-z][A-Za-z '-]{1,60}$/.test(term)).sort((a,b) => b.length-a.length).slice(0,400).forEach((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    html = html.replace(new RegExp(`\\b(${escaped})\\b`, "gi"), "<mark>$1</mark>");
  });
  return html;
}

function renderCompactDigest() {
  const box = inlineDigestContainer;
  const video = document.querySelector("video.html5-main-video");
  if (!box?.isConnected || !video || !compactDigestSegments.length) return;
  const now = video.currentTime || 0;
  let index = compactDigestSegments.findIndex((item, i) => now >= item.start && now < (compactDigestSegments[i + 1]?.start ?? Infinity));
  if (index < 0) index = 0;
  if (compactDigestLoopIndex >= 0) {
    index = Math.min(compactDigestLoopIndex, compactDigestSegments.length - 1);
    const loopEnd = getCompactLoopEnd(index, video);
    if (!compactDigestLoopWaiting && now >= loopEnd) {
      compactDigestLoopWaiting = true;
      video.pause();
      compactDigestLoopTimeout = setTimeout(() => {
        compactDigestLoopTimeout = null;
        compactDigestLoopWaiting = false;
        if (compactDigestLoopIndex < 0 || !video.isConnected) return;
        video.currentTime = Number(compactDigestSegments[compactDigestLoopIndex]?.start) || 0;
        video.play().catch(() => {});
      }, compactDigestLoopGapMs);
    }
  }
  const item = compactDigestSegments[index];
  if (Date.now() - compactDigestLastCacheRefresh > 3000) {
    compactDigestLastCacheRefresh = Date.now();
    refreshCompactDigestCache();
  }
  if (box.dataset.active === item.id) return;
  box.dataset.active = item.id;
  const seconds = Math.max(0, Math.floor(item.start || 0));
  box.querySelector(".ytd-digest-overlay-time").textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  box.querySelector(".ytd-digest-overlay-en").innerHTML = compactDigestHighlight(item.text, item.terms);
  box.querySelector(".ytd-digest-overlay-zh").textContent = item.translation || "中文翻译尚未缓存，请在完整学习区生成";
  box.classList.toggle("mode-en", compactDigestMode === "en");
  box.classList.toggle("mode-zh", compactDigestMode === "zh");
  box.classList.toggle("mode-bilingual", compactDigestMode === "bilingual");
  box.querySelector(".ytd-digest-overlay-line").onclick = () => { video.currentTime = item.start; video.play().catch(() => {}); };
}

function getCompactLoopEnd(index, video) {
  const start = Number(compactDigestSegments[index]?.start) || 0;
  const nextStart = Number(compactDigestSegments[index + 1]?.start);
  if (Number.isFinite(nextStart) && nextStart > start) return Math.max(start + 0.35, nextStart - 0.08);
  if (Number.isFinite(video.duration) && video.duration > start) return video.duration;
  return start + 5;
}

function getCompactPlaybackIndex(video) {
  const now = video?.currentTime || 0;
  const found = compactDigestSegments.findIndex((item, i) => now >= item.start && now < (compactDigestSegments[i + 1]?.start ?? Infinity));
  return found < 0 ? 0 : found;
}

function clearCompactLoopWait() {
  if (compactDigestLoopTimeout) clearTimeout(compactDigestLoopTimeout);
  compactDigestLoopTimeout = null;
  compactDigestLoopWaiting = false;
}

function handleCompactLoopAction(action) {
  const video = document.querySelector("video.html5-main-video");
  if (!video || !compactDigestSegments.length) return;

  if (action === "toggle") {
    if (compactDigestLoopIndex >= 0) {
      compactDigestLoopIndex = -1;
      clearCompactLoopWait();
    } else {
      compactDigestLoopIndex = getCompactPlaybackIndex(video);
      video.currentTime = Number(compactDigestSegments[compactDigestLoopIndex]?.start) || 0;
      video.play().catch(() => {});
    }
  } else if (action === "previous" || action === "next") {
    const current = compactDigestLoopIndex >= 0 ? compactDigestLoopIndex : getCompactPlaybackIndex(video);
    const offset = action === "previous" ? -1 : 1;
    compactDigestLoopIndex = Math.max(0, Math.min(compactDigestSegments.length - 1, current + offset));
    clearCompactLoopWait();
    video.currentTime = Number(compactDigestSegments[compactDigestLoopIndex]?.start) || 0;
    video.play().catch(() => {});
  } else if (action === "gap") {
    const gaps = [800, 1500, 2500];
    compactDigestLoopGapMs = gaps[(gaps.indexOf(compactDigestLoopGapMs) + 1) % gaps.length];
  }

  inlineDigestContainer.dataset.active = "";
  updateCompactLoopControls();
  renderCompactDigest();
}

function updateCompactLoopControls() {
  const toggle = inlineDigestContainer?.querySelector('[data-loop-action="toggle"]');
  const gap = inlineDigestContainer?.querySelector('[data-loop-action="gap"]');
  if (toggle) {
    const active = compactDigestLoopIndex >= 0;
    toggle.classList.toggle("active", active);
    toggle.setAttribute("aria-pressed", String(active));
    toggle.textContent = active ? "停止" : "跟读";
  }
  if (gap) gap.textContent = `留白 ${(compactDigestLoopGapMs / 1000).toFixed(1)}s`;
}

async function refreshCompactDigestCache() {
  if (!compactDigestVideoId || !inlineDigestContainer?.isConnected) return;
  compactDigestLastCacheRefresh = Date.now();
  const videoIdAtRequest = compactDigestVideoId;
  try {
    const result = await chrome.runtime.sendMessage({
      action: "getCompactTranscriptData",
      videoId: videoIdAtRequest,
    });
    if (!result?.success) return;
    // The user may have navigated to another video while this was in flight.
    if (compactDigestVideoId !== videoIdAtRequest) return;
    const source = result.compactSegments?.length
      ? result.compactSegments
      : (result.transcript || []).map((item, index) => ({ id: `raw-${index}`, start: Number(item.start) || 0, text: item.text || "" }));
    const terms = [...(result.vocabulary || []), ...(result.learningItems || []).map((item) => item.term)];
    compactDigestSegments = source.map((item) => ({
      ...item,
      translation: result.paragraphCache?.[`${compactDigestVideoId}:zh:semantic:${item.id}`] || "",
      terms,
    }));
    const status = inlineDigestContainer.querySelector(".ytd-digest-overlay-status");
    if (status) status.textContent = "跟随播放 · 复用精读缓存";
    inlineDigestContainer.dataset.active = "";
    if (compactDigestTimer) clearInterval(compactDigestTimer);
    compactDigestTimer = setInterval(renderCompactDigest, 350);
    renderCompactDigest();
  } catch (_) {
    // Side panel may be rebuilding its cache; the next refresh will retry.
  }
}

function updateCompactModeButtons() {
  inlineDigestContainer?.querySelectorAll("[data-mode]").forEach((button) => {
    const active = button.dataset.mode === compactDigestMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function stopCompactDigest() {
  if (compactDigestTimer) clearInterval(compactDigestTimer);
  compactDigestTimer = null;
  compactDigestSegments = [];
  compactDigestVideoId = "";
  compactDigestLastCacheRefresh = 0;
  compactDigestLoopIndex = -1;
  clearCompactLoopWait();
}

const compactDigestStyle = document.createElement("style");
compactDigestStyle.textContent = `
#ytd-digest-inline{position:absolute;z-index:61;left:9%;right:9%;bottom:50px;min-height:78px;border:1px solid rgba(255,255,255,.18);border-radius:12px;background:rgba(18,17,15,.76);color:#fff;overflow:hidden;font-family:Roboto,Arial,sans-serif;box-shadow:0 5px 22px rgba(0,0,0,.3);backdrop-filter:blur(7px)}
.ytd-digest-overlay-head{height:26px;padding:2px 6px 0;display:flex;align-items:center;gap:5px;opacity:.62;transition:opacity .15s}#ytd-digest-inline:hover .ytd-digest-overlay-head{opacity:1}.ytd-digest-overlay-status{flex:1;padding-left:7px;color:#ddd;font-size:10px}.ytd-digest-overlay-head button{border:1px solid rgba(255,255,255,.25);border-radius:999px;background:rgba(0,0,0,.28);padding:2px 7px;color:#fff;cursor:pointer;font-size:10px}.ytd-digest-overlay-modes,.ytd-digest-loop-controls{display:flex;gap:3px}.ytd-digest-overlay-modes button.active,.ytd-digest-loop-controls button.active{background:#c8674f;border-color:#dc8b76;font-weight:700}.ytd-digest-loop-controls button:first-child,.ytd-digest-loop-controls button:nth-child(3){font-size:15px;line-height:11px;padding-inline:6px}
.ytd-digest-overlay-line{width:100%;min-height:52px;padding:0 14px 9px;display:grid;grid-template-columns:42px 1fr;gap:8px;align-items:center;text-align:left;border:0;background:transparent;color:#fff;cursor:pointer}.ytd-digest-overlay-time{font:600 11px ui-monospace,Menlo,monospace;color:#ef9b82}.ytd-digest-overlay-copy,.ytd-digest-overlay-en,.ytd-digest-overlay-zh{display:block}.ytd-digest-overlay-en{font-size:16px;font-weight:600;line-height:1.35;text-shadow:0 1px 3px #000}.ytd-digest-overlay-zh{font-size:14px;line-height:1.35;margin-top:3px;color:#f3eee7;text-shadow:0 1px 3px #000}.ytd-digest-overlay-en mark{background:#f1cf67;color:#211c16;border-radius:3px;padding:0 2px;text-shadow:none}#ytd-digest-inline.mode-en .ytd-digest-overlay-zh{display:none}#ytd-digest-inline.mode-zh .ytd-digest-overlay-en{display:none}#ytd-digest-inline.mode-zh .ytd-digest-overlay-zh{margin-top:0;font-size:16px}
@media(max-width:1100px){.ytd-digest-overlay-status{display:none}}@media(max-width:900px){#ytd-digest-inline{left:3%;right:3%;bottom:44px}.ytd-digest-loop-controls [data-loop-action="gap"]{display:none}.ytd-digest-overlay-line{padding:0 10px 9px;grid-template-columns:40px 1fr}.ytd-digest-overlay-en{font-size:14px}.ytd-digest-overlay-zh{font-size:13px}}
`;
(document.head || document.documentElement || document.body)?.appendChild(compactDigestStyle);

/**
 * Reconciles the Digest button with YouTube's currently visible action row.
 * This is intentionally idempotent because YouTube rebuilds its watch page
 * during navigation and at responsive breakpoints.
 */
function injectDigestButton() {
  const existingButtons = Array.from(
    document.querySelectorAll("#ytd-digest-button"),
  );

  if (!window.location.pathname.includes("/watch")) {
    existingButtons.forEach((button) => button.remove());
    ytdDigestButton = null;
    return false;
  }

  const actionsContainer = findDigestButtonHost();
  if (!actionsContainer) {
    debugLog("[YouTube Digest Content] Visible actions container not found yet");
    return false;
  }

  let digestButton = existingButtons.find(
    (button) => button === ytdDigestButton,
  );

  if (!digestButton) {
    existingButtons.forEach((button) => button.remove());
    existingButtons.length = 0;
    digestButton = createDigestButton();
  }

  existingButtons.forEach((button) => {
    if (button !== digestButton) button.remove();
  });

  if (digestButton.parentElement !== actionsContainer) {
    // YouTube turns #actions-inner into a vertical flex column at narrow
    // breakpoints. A direct child there stretches into a full-width second
    // row, so keep Digest inside the native horizontal button group and
    // prepend it to preserve visibility when space is limited.
    actionsContainer.insertBefore(digestButton, actionsContainer.firstChild);
  }

  debugLog("[YouTube Digest Content] Digest button reconciled");
  return true;
}

function scheduleDigestButtonReconciliation(delay = 80) {
  if (digestButtonReconcileTimer) {
    clearTimeout(digestButtonReconcileTimer);
  }

  digestButtonReconcileTimer = setTimeout(() => {
    digestButtonReconcileTimer = null;
    injectDigestButton();
  }, delay);
}

function setupDigestButtonResizeListener() {
  if (digestButtonResizeListenerAdded) return;

  window.addEventListener("resize", () => {
    scheduleDigestButtonReconciliation(120);
  });
  digestButtonResizeListenerAdded = true;
}

/**
 * Sets up a MutationObserver to watch for YouTube's dynamic content changes.
 * When the action buttons container appears (after navigation), we inject our button.
 */
function setupButtonObserver() {
  if (digestButtonObserver) return;

  digestButtonObserver = new MutationObserver(() => {
    // Check if we need to inject the buttons
    if (window.location.pathname.includes("/watch")) {
      scheduleDigestButtonReconciliation();
      if (!ytdNoteButton || !ytdNoteButton.isConnected) {
        tryInjectNoteButton();
      }
    }
  });

  // Watch the entire body for changes (YouTube rebuilds large chunks of the DOM)
  digestButtonObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// ============================================================
// NOTE BUTTON (Overlay on Video Player)
// ============================================================

/**
 * Injects a "Note" button overlay on top of the YouTube video player.
 * The button appears when the mouse enters or moves over the player and hides
 * after the cursor stays still for more than 2 seconds or leaves the player.
 */
function injectNoteButton() {
  // Don't inject if we're not on a video page
  if (!window.location.pathname.includes("/watch")) return;

  // Don't inject if button already exists and is properly tracked.
  // If a stale button exists (e.g., from a previous content-script instance),
  // remove it and re-inject so event listeners are attached to the live one.
  const existingButton = document.getElementById("ytd-note-button");
  if (existingButton) {
    if (ytdNoteButton === existingButton && existingButton.isConnected) {
      return; // already injected and connected
    }
    existingButton.remove();
  }

  // Find the video player container. YouTube rebuilds this dynamically, so
  // we try the most common selectors.
  const playerContainer = document.querySelector(
    "#movie_player.html5-video-player, " +
      "#movie_player, " +
      ".html5-video-player",
  );

  if (!playerContainer) {
    debugLog(
      "[YouTube Digest Content] Player container not found yet, will retry",
    );
    return;
  }

  // Ensure the player container has relative positioning for absolute children
  if (
    window.getComputedStyle(playerContainer).position === "static" ||
    !playerContainer.style.position
  ) {
    playerContainer.style.position = "relative";
  }

  debugLog("[YouTube Digest Content] Injecting note button");

  // Create the note button — a soft rounded pill that floats over the player
  const noteButton = document.createElement("button");
  noteButton.id = "ytd-note-button";
  noteButton.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="margin-right: 7px;">
      <path d="M12 20h9"></path>
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
    </svg>
    <span>Note</span>
  `;

  // Soft rounded pill in the terracotta accent, with a gentle shadow.
  // Start hidden; visibility is controlled by mouse activity.
  noteButton.style.cssText = `
    position: absolute;
    top: 16px;
    right: 16px;
    z-index: 9999;
    display: flex;
    align-items: center;
    padding: 9px 16px;
    background: #c8674f;
    color: white;
    border: none;
    border-radius: 999px;
    font-family: system-ui, -apple-system, "Roboto", sans-serif;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.2px;
    cursor: pointer;
    transition: opacity 0.18s ease, transform 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
    opacity: 0;
    pointer-events: none;
    box-shadow: 0 4px 14px rgba(0,0,0,0.3);
  `;

  ytdNoteButton = noteButton;

  // Show button when mouse enters or moves over the player.
  // Hide after 2 seconds of idle or when the mouse leaves.
  playerContainer.addEventListener("mouseenter", () => {
    showNoteButton();
    resetNoteButtonTimer();
  });

  playerContainer.addEventListener("mousemove", () => {
    showNoteButton();
    resetNoteButtonTimer();
  });

  playerContainer.addEventListener("mouseleave", () => {
    clearTimeout(ytdNoteButtonTimer);
    ytdNoteButtonTimer = null;
    hideNoteButton();
  });

  // Hover effect — lift slightly
  noteButton.addEventListener("mouseenter", () => {
    noteButton.style.background = "#b25742";
    noteButton.style.boxShadow = "0 6px 18px rgba(0,0,0,0.35)";
    noteButton.style.transform = "translateY(-1px)";
  });

  noteButton.addEventListener("mouseleave", () => {
    noteButton.style.background = "#c8674f";
    noteButton.style.boxShadow = "0 4px 14px rgba(0,0,0,0.3)";
    noteButton.style.transform = "translateY(0)";
  });

  // Click handler — save the current moment as a note
  noteButton.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await saveCurrentNote();
  });

  playerContainer.appendChild(noteButton);

  debugLog("[YouTube Digest Content] Note button injected");
}

function showNoteButton() {
  if (!ytdNoteButton) return;
  ytdNoteButton.style.opacity = "1";
  ytdNoteButton.style.pointerEvents = "auto";
}

function hideNoteButton() {
  if (!ytdNoteButton) return;
  ytdNoteButton.style.opacity = "0";
  ytdNoteButton.style.pointerEvents = "none";
}

function resetNoteButtonTimer() {
  clearTimeout(ytdNoteButtonTimer);
  ytdNoteButtonTimer = setTimeout(() => {
    hideNoteButton();
  }, 2000);
}

/**
 * Handles the "n" keyboard shortcut for saving a note.
 * Only triggers on YouTube watch pages and when the user is not typing
 * in an input field.
 */
function handleNoteKeyboardShortcut(e) {
  if (!window.location.pathname.includes("/watch")) return;
  if (e.key !== "n" && e.key !== "N") return;

  // Ignore if the user is typing in an input/textarea/contenteditable
  const active = document.activeElement;
  if (
    active &&
    (active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      active.isContentEditable)
  ) {
    return;
  }

  // Prevent YouTube's own "n" shortcut (e.g. next video in playlist)
  e.preventDefault();
  e.stopPropagation();

  // Show brief visual feedback on the button, then save
  showNoteButton();
  resetNoteButtonTimer();
  saveCurrentNote();
}

/**
 * Captures the current timestamp and saves it as a note.
 */
async function saveCurrentNote() {
  debugLog("[YouTube Digest] Saving note");

  const video = document.querySelector("video.html5-main-video");
  if (!video) {
    console.error("[YouTube Digest] No video element found");
    return;
  }

  // Go back 3 seconds to capture what was just said (user reacts after hearing it)
  const currentTime = Math.max(0, Math.floor(video.currentTime) - 3);
  const videoInfo = extractVideoInfo();
  const videoId = new URLSearchParams(window.location.search).get("v");

  const noteButton = ytdNoteButton;
  const originalContent = noteButton ? noteButton.innerHTML : "";

  if (noteButton) {
    noteButton.innerHTML =
      '<span style="letter-spacing: 0.2px;">SAVING...</span>';
    noteButton.style.pointerEvents = "none";
  }

  try {
    const result = await chrome.runtime.sendMessage({
      action: "saveNote",
      videoId: videoId,
      timestamp: currentTime,
      videoTitle: videoInfo.title,
      channelName: videoInfo.channelName,
    });

    if (result.success) {
      if (noteButton) {
        noteButton.innerHTML =
          '<span style="letter-spacing: 0.2px;">SAVED</span>';
        noteButton.style.background = "#7c8b6f";
      }
      showNoteSavedToast(result.note);
    } else {
      if (noteButton) {
        noteButton.innerHTML =
          '<span style="letter-spacing: 0.2px;">ERROR</span>';
      }
      console.error("[YouTube Digest] Save note error:", result.error);
    }
  } catch (err) {
    if (noteButton) {
      noteButton.innerHTML =
        '<span style="letter-spacing: 0.2px;">ERROR</span>';
    }
    console.error("[YouTube Digest] Save note exception:", err);
  }

  setTimeout(() => {
    if (noteButton) {
      noteButton.innerHTML = originalContent;
      noteButton.style.background = "#c8674f";
      noteButton.style.pointerEvents = "auto";
    }
  }, 2000);
}

/**
 * Shows a toast notification when a note is saved.
 */
function showNoteSavedToast(note) {
  // Remove existing toast
  const existing = document.getElementById("ytd-note-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "ytd-note-toast";
  toast.innerHTML = `
    <div style="font-weight: 700; margin-bottom: 6px; color: #c8674f;">📝 Note saved</div>
    <div style="font-size: 12px; color: #6b6258; margin-bottom: 8px;">${escapeHtmlForContent(note.timestamp)} — ${escapeHtmlForContent(note.videoTitle)}</div>
    <div style="font-size: 13px; line-height: 1.55; color: #2e2a24;">"${escapeHtmlForContent(note.text)}"</div>
    <div style="margin-top: 10px; font-size: 11px;">
      <a href="${escapeHtmlForContent(note.timestampedUrl)}" style="color: #c8674f; font-weight: 600; text-decoration: none;">🔗 Copy link</a>
    </div>
  `;

  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 999999;
    background: #ffffff;
    border: 1px solid #ece5d9;
    border-radius: 14px;
    padding: 16px 20px;
    max-width: 350px;
    box-shadow: 0 12px 32px rgba(50, 42, 32, 0.2);
    font-family: system-ui, -apple-system, "Roboto", sans-serif;
    animation: ytdSlideIn 0.3s ease;
  `;

  // Add animation keyframes
  const style = document.createElement("style");
  style.textContent = `
    @keyframes ytdSlideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);

  // Copy link handler
  toast.querySelector("a").addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(note.timestampedUrl);
      e.target.textContent = "✓ Copied!";
    } catch (err) {
      console.error("Copy failed:", err);
    }
  });

  document.body.appendChild(toast);

  // Auto-dismiss after 5 seconds
  setTimeout(() => {
    toast.style.animation = "ytdSlideIn 0.3s ease reverse";
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

// ============================================================
// VIDEO INFO EXTRACTION
// ============================================================

/**
 * Reads the video title, channel name, and description directly from YouTube's page.
 * These are just sitting in the HTML — we grab them from the DOM elements.
 */
function extractVideoInfo() {
  // The video title is in an h1 element inside the #title container
  const titleElement = document.querySelector(
    "h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string",
  );

  // The channel name is in the channel info section
  const channelElement = document.querySelector(
    "#channel-name yt-formatted-string a, ytd-channel-name yt-formatted-string a",
  );

  // Video duration from the video element
  const videoElement = document.querySelector("video.html5-main-video");

  // Video description — YouTube has this in a few possible places
  const descriptionElement = document.querySelector(
    "#description-inner, " +
      "ytd-watch-metadata #description yt-attributed-string, " +
      "#description yt-formatted-string, " +
      "ytd-expander#description yt-attributed-string",
  );

  return {
    title: titleElement?.textContent?.trim() || "",
    channelName: channelElement?.textContent?.trim() || "",
    duration: videoElement?.duration || 0,
    description: descriptionElement?.textContent?.trim() || "",
  };
}

// ============================================================
// PROGRESS BAR KEY MOMENTS
// ============================================================

/**
 * Adds colored marker dots to YouTube's video progress bar
 * at the positions of key moments identified by the AI provider.
 *
 * How it works:
 * - YouTube's progress bar is a <div> element with a known class
 * - We calculate each moment's position as a percentage of total duration
 * - We inject small colored <div> elements at those positions
 * - The markers are absolutely positioned on top of the progress bar
 *
 * This is a "bonus feature" — it gives you a visual preview
 * of where the good stuff is in the video.
 */
function highlightKeyMoments(moments, videoDuration) {
  // Disabled: no timeline markers. Chapters live only in the side panel.
  return;
}

// ============================================================
// SEEK TO TIMESTAMP
// ============================================================

/**
 * Jumps the YouTube video to a specific timestamp (in seconds).
 * This is called when the user clicks a timestamp in the side panel.
 *
 * We simply set the video element's .currentTime property,
 * which is the standard HTML5 way to seek in a video.
 */
function seekToTimestamp(seconds) {
  const video = document.querySelector("video.html5-main-video");
  if (!video) {
    console.error("[YouTube Digest Content] No video element found for seek");
    return;
  }

  debugLog("[YouTube Digest Content] Seeking to:", seconds);
  video.currentTime = seconds;
  // Also play the video if it's paused
  if (video.paused) {
    video.play().catch(() => {}); // Ignore autoplay errors
  }
}

function escapeHtmlForContent(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

// ============================================================
// PAGE NAVIGATION DETECTION
// ============================================================

/**
 * YouTube is a "Single Page Application" (SPA). This means when you
 * click on a new video, the page doesn't fully reload — YouTube
 * dynamically swaps out the content. So our content script stays alive
 * but needs to detect when the video changes.
 *
 * We watch for URL changes using the `yt-navigate-finish` event,
 * which YouTube fires after navigation completes. When that happens,
 * we clean up old markers and re-inject the button.
 */
document.addEventListener("yt-navigate-finish", () => {
  // Clean up old key moment markers when navigating to a new video
  const existingMarkers = document.querySelectorAll(".ytd-key-moment-markers");
  existingMarkers.forEach((m) => m.remove());

  // Remove old buttons (they will be re-injected for the new video)
  document
    .querySelectorAll("#ytd-digest-button")
    .forEach((button) => button.remove());
  ytdDigestButton = null;
  document.getElementById("ytd-digest-inline")?.remove();
  stopCompactDigest();
  inlineDigestContainer = null;
  if (digestButtonReconcileTimer) {
    clearTimeout(digestButtonReconcileTimer);
    digestButtonReconcileTimer = null;
  }

  const existingNoteButton = document.getElementById("ytd-note-button");
  if (existingNoteButton) existingNoteButton.remove();

  // Reset note button state
  ytdNoteButton = null;
  clearTimeout(ytdNoteButtonTimer);
  ytdNoteButtonTimer = null;
  if (ytdNoteButtonRetryTimer) {
    clearInterval(ytdNoteButtonRetryTimer);
    ytdNoteButtonRetryTimer = null;
  }

  // Remove any toasts
  const existingToast = document.getElementById("ytd-note-toast");
  if (existingToast) existingToast.remove();

  // Re-inject buttons for the new video (with a small delay for YouTube to render)
  setTimeout(() => {
    scheduleDigestButtonReconciliation(0);
    tryInjectNoteButton();
  }, 500);
});

// ============================================================
// TRANSCRIPT EXTRACTION
// ============================================================
//
// Both transcript sources hand the background the same payload, which is the
// shape Supadata's API returns:
//
//   { content: [{ text, offset, duration, lang }], lang, availableLangs }
//
// offset and duration are milliseconds. Nothing downstream needs to know
// whether YouTube's own captions or Supadata produced it.

// This extension is an English intensive-reading tool, so an English track
// beats a translated one, and a human-written track beats auto-generated.
const CAPTION_LANGUAGE_PREFERENCE = ["en"];

const TRANSCRIPT_PANEL_TIMEOUT_MS = 90_000;
const TRANSCRIPT_PANEL_POLL_MS = 700;
const TRANSCRIPT_PANEL_STABLE_ROUNDS = 3;
const TRANSCRIPT_LAST_CHUNK_MS = 3000;

const BRIDGE_REQUEST_EVENT = "ytd-digest-bridge-request";
const BRIDGE_RESPONSE_EVENT = "ytd-digest-bridge-response";
const BRIDGE_TIMEOUT_MS = 4000;

let pageBridgeInstalled = false;

const transcriptSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const cleanCaptionText = (value) =>
  String(value ?? "")
    .replace(/​/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Keeps the side panel's loading view honest while a slow read runs. */
function reportTranscriptProgress(subtitle) {
  chrome.runtime
    .sendMessage({
      action: "transcriptProgress",
      title: "Fetching transcript",
      subtitle,
    })
    .catch(() => {});
}

/**
 * Asks the page world for the current video's caption tracks, injecting the
 * bridge on first use. Resolves to null when the page never answers.
 */
function requestCaptionTracks() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      window.removeEventListener(BRIDGE_RESPONSE_EVENT, onResponse);
      resolve(value);
    };
    const onResponse = (event) => {
      try {
        finish(JSON.parse(event.detail));
      } catch (error) {
        finish(null);
      }
    };

    window.addEventListener(BRIDGE_RESPONSE_EVENT, onResponse);
    if (pageBridgeInstalled) {
      window.dispatchEvent(new CustomEvent(BRIDGE_REQUEST_EVENT));
    } else {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("page-bridge.js");
      script.onload = () => script.remove();
      script.onerror = () => finish(null);
      (document.head ?? document.documentElement).appendChild(script);
      pageBridgeInstalled = true;
    }
    setTimeout(() => finish(null), BRIDGE_TIMEOUT_MS);
  });
}

function pickCaptionTrack(tracks) {
  const speaks = (track, code) =>
    String(track.languageCode || "")
      .toLowerCase()
      .startsWith(code);
  for (const code of CAPTION_LANGUAGE_PREFERENCE) {
    const track =
      tracks.find((item) => speaks(item, code) && item.kind !== "asr") ??
      tracks.find((item) => speaks(item, code));
    if (track) return track;
  }
  return tracks.find((item) => item.kind !== "asr") ?? tracks[0];
}

/** Downloads one caption track as Supadata-shaped chunks. */
async function fetchCaptionTrackChunks(track) {
  if (!track?.baseUrl) return [];
  try {
    const captionUrl = new URL(track.baseUrl, location.origin);
    captionUrl.searchParams.set("fmt", "json3");
    const response = await fetch(captionUrl.href, { credentials: "include" });
    if (!response.ok) return [];
    const raw = await response.text();
    if (!raw.trim()) return [];
    return (JSON.parse(raw).events ?? [])
      .filter((event) => Array.isArray(event.segs))
      .map((event) => ({
        text: cleanCaptionText(event.segs.map((seg) => seg.utf8 ?? "").join("")),
        offset: Number(event.tStartMs) || 0,
        duration: Number(event.dDurationMs) || 0,
        lang: track.languageCode || "",
      }))
      .filter((chunk) => chunk.text);
  } catch (error) {
    debugLog("[YouTube Digest Content] Caption fetch failed:", error.message);
    return [];
  }
}

// ---- Transcript panel fallback ------------------------------------------

const TRANSCRIPT_STAMP = /^(?:\d{1,2}:)?\d{1,2}:\d{2}$/;
// Timestamps also appear on the player clock, related-video badges, and
// comment permalinks. None of those belong to a transcript.
const TRANSCRIPT_EXCLUDE = [
  "#movie_player",
  "#related",
  "ytd-watch-next-secondary-results-renderer",
  "#comments",
  "ytd-compact-video-renderer",
  "ytd-thumbnail-overlay-time-status-renderer",
  "#ytd-digest-inline",
].join(", ");

const isTranscriptStampLeaf = (el) =>
  !el.firstElementChild && TRANSCRIPT_STAMP.test((el.textContent || "").trim());

/**
 * Finds the transcript rows without trusting any element name or container.
 *
 * YouTube renames these custom elements and moves the panel between hosts, and
 * the element carrying target-id="engagement-panel-searchable-transcript" can
 * sit hidden and empty while a different one renders the real rows. So collect
 * every timestamp label on the page and keep the largest group of sibling
 * rows: a transcript holds far more of them than anything else does.
 */
function findTranscriptRows() {
  const legacy = document.querySelectorAll("ytd-transcript-segment-renderer");
  if (legacy.length) return [...legacy];

  const groups = new Map();
  for (const stamp of document.querySelectorAll("*")) {
    if (!isTranscriptStampLeaf(stamp) || stamp.closest(TRANSCRIPT_EXCLUDE)) continue;
    const stampLength = (stamp.textContent || "").trim().length;

    // Walk up to the row: the nearest ancestor that adds caption text without
    // swallowing a second timestamp.
    let node = stamp.parentElement;
    let row = null;
    while (node && node !== document.body) {
      if ([...node.querySelectorAll("*")].filter(isTranscriptStampLeaf).length > 1) break;
      if ((node.textContent || "").trim().length > stampLength + 1) {
        row = node;
        break;
      }
      node = node.parentElement;
    }
    if (!row?.parentElement) continue;
    const siblings = groups.get(row.parentElement) ?? [];
    if (!siblings.includes(row)) siblings.push(row);
    groups.set(row.parentElement, siblings);
  }

  let best = [];
  for (const siblings of groups.values()) {
    if (siblings.length > best.length) best = siblings;
  }
  // One or two stray matches are a clock or a badge, not a transcript.
  return best.length >= 3 ? best : [];
}

function isTranscriptElementVisible(el) {
  if (!el) return false;
  const style = getComputedStyle(el);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    el.getClientRects().length > 0
  );
}

/**
 * Opens YouTube's own transcript panel, retrying because the description has
 * to expand before the button renders and the panel loads lazily.
 */
async function openTranscriptPanel() {
  const labels = [
    "show transcript",
    "open transcript",
    "内容转文字",
    "內容轉文字",
    "显示文字记录",
    "顯示文字記錄",
    "显示转录内容",
    "顯示轉錄內容",
    "查看文字记录",
    "查看文字記錄",
    "转写文稿",
    "轉寫文稿",
  ];

  const expandDescription = () => {
    const expander = [
      "ytd-watch-metadata #description-inline-expander #expand",
      "ytd-watch-metadata ytd-text-inline-expander #expand",
      "#description-inline-expander #expand",
      "tp-yt-paper-button#expand",
      "ytd-watch-metadata #expand",
    ]
      .map((selector) => document.querySelector(selector))
      .find(isTranscriptElementVisible);
    if (expander) expander.click();
  };

  const clickTranscriptButton = () => {
    const direct = [
      "ytd-video-description-transcript-section-renderer #show-transcript",
      "ytd-video-description-transcript-section-renderer button",
      "ytd-video-description-transcript-section-renderer tp-yt-paper-button",
    ]
      .map((selector) => document.querySelector(selector))
      .find(isTranscriptElementVisible);
    const byLabel = [
      ...document.querySelectorAll(
        "button, tp-yt-paper-button, ytd-button-renderer, yt-button-shape, tp-yt-paper-item, ytd-menu-service-item-renderer",
      ),
    ].find((candidate) => {
      if (!isTranscriptElementVisible(candidate)) return false;
      const label = cleanCaptionText(
        `${candidate.getAttribute("aria-label") ?? ""} ${candidate.textContent ?? ""}`,
      ).toLowerCase();
      return labels.some((text) => label.includes(text));
    });
    const button = direct ?? byLabel;
    if (!button) return false;
    (button.querySelector?.("button") ?? button).click();
    return true;
  };

  // Last resort: flip the engagement panel open ourselves. Polymer reflects
  // this property, so assigning it renders the panel even when no button for
  // it is reachable.
  const forcePanelOpen = () => {
    const panels = document.querySelectorAll(
      '[target-id="engagement-panel-searchable-transcript"]',
    );
    for (const panel of panels) {
      try {
        panel.visibility = "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED";
      } catch (error) {
        // Not Polymer-backed; the attribute below still applies.
      }
      panel.setAttribute("visibility", "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED");
    }
    return panels.length > 0;
  };

  if (findTranscriptRows().length) return "already-open";

  expandDescription();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (clickTranscriptButton()) {
      await transcriptSleep(400);
      if (findTranscriptRows().length) return "button";
    }
    if (attempt === 3) expandDescription();
    if (attempt === 6 && forcePanelOpen()) {
      await transcriptSleep(600);
      if (findTranscriptRows().length) return "forced";
    }
    await transcriptSleep(400);
  }
  return findTranscriptRows().length ? "late" : "unopened";
}

function transcriptTimestampToMs(value) {
  const parts = String(value ?? "")
    .trim()
    .split(":")
    .map(Number);
  if (parts.length < 2 || parts.some((part) => !Number.isFinite(part))) return null;
  return parts.reduce((total, part) => total * 60 + part, 0) * 1000;
}

/**
 * Scrolls the virtualized transcript panel and reads every row.
 * The panel only keeps the visible slice in the DOM, so this has to walk it.
 */
async function collectTranscriptPanelChunks(languageCode) {
  const collected = new Map();
  const collect = () => {
    for (const row of findTranscriptRows()) {
      const raw = cleanCaptionText(row.textContent);
      const stamp =
        cleanCaptionText(
          row.querySelector("#segment-timestamp, .segment-timestamp")?.textContent,
        ) ||
        cleanCaptionText(
          [...row.querySelectorAll("*")].find(isTranscriptStampLeaf)?.textContent,
        ) ||
        raw.match(/(?:^|\s)((?:\d{1,2}:)?\d{1,2}:\d{2})(?:\s|$)/)?.[1] ||
        "";
      const offset = transcriptTimestampToMs(stamp);
      if (offset === null) continue;
      const text = cleanCaptionText(
        row.querySelector("#segment-text, .segment-text")?.textContent ??
          raw.replace(stamp, ""),
      );
      if (text) collected.set(`${offset}:${text}`, { offset, text });
    }
  };

  collect();
  const first = findTranscriptRows()[0];
  if (!first) return [];

  const panel =
    first.closest(
      "ytd-engagement-panel-section-list-renderer, ytd-transcript-renderer",
    ) ?? first.parentElement;
  const candidates = [];
  let ancestor = first.parentElement;
  while (ancestor && ancestor !== document.body) {
    candidates.push(ancestor);
    ancestor = ancestor.parentElement;
  }
  if (panel) candidates.push(...panel.querySelectorAll("*"));
  const scroller = candidates
    .filter(
      (el) =>
        /(auto|scroll)/.test(getComputedStyle(el).overflowY) &&
        el.scrollHeight > el.clientHeight + 20,
    )
    .sort(
      (a, b) =>
        b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight),
    )[0];

  if (scroller) {
    const originalTop = scroller.scrollTop;
    scroller.scrollTop = 0;
    await transcriptSleep(150);
    let unchanged = 0;
    let previousSize = -1;
    for (let round = 0; round < 400; round += 1) {
      collect();
      unchanged = collected.size === previousSize ? unchanged + 1 : 0;
      previousSize = collected.size;
      if (round % 4 === 0) {
        reportTranscriptProgress(`Collecting captions: ${collected.size} lines`);
      }
      const atBottom =
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      if (atBottom && unchanged >= 3) break;
      scroller.scrollTop = Math.min(
        scroller.scrollTop + Math.max(scroller.clientHeight * 0.8, 300),
        scroller.scrollHeight,
      );
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      await transcriptSleep(110);
    }
    scroller.scrollTop = originalTop;
  } else {
    await transcriptSleep(800);
    collect();
  }

  // The panel gives no durations, so derive each one from the next start.
  const rows = [...collected.values()].sort((a, b) => a.offset - b.offset);
  return rows.map((row, index) => ({
    text: row.text,
    offset: row.offset,
    duration: rows[index + 1]
      ? Math.max(0, rows[index + 1].offset - row.offset)
      : TRANSCRIPT_LAST_CHUNK_MS,
    lang: languageCode || "",
  }));
}

// ---- Orchestration ------------------------------------------------------

/**
 * Reads this video's transcript and returns it in Supadata's payload shape.
 * Tries YouTube's caption track first, then its transcript panel.
 */
async function extractTranscriptPayload() {
  reportTranscriptProgress("Reading YouTube captions");
  const page = await requestCaptionTracks();
  const tracks = Array.isArray(page?.tracks) ? page.tracks : [];
  const availableLangs = [
    ...new Set(tracks.map((track) => track.languageCode).filter(Boolean)),
  ];

  let languageCode = "";
  if (tracks.length) {
    const track = pickCaptionTrack(tracks);
    languageCode = track?.languageCode || "";
    const chunks = await fetchCaptionTrackChunks(track);
    if (chunks.length) {
      return {
        success: true,
        via: "caption-api",
        payload: { content: chunks, lang: languageCode, availableLangs },
      };
    }
  } else if (page) {
    // The player answered and reported no tracks at all.
    return {
      success: false,
      error: "NO_TRANSCRIPT",
      message: "This video has no subtitle track.",
    };
  }

  // The caption endpoint sometimes returns nothing even though captions
  // exist. YouTube's own transcript panel still renders them, so read that.
  reportTranscriptProgress("Opening YouTube's transcript panel");
  const via = await openTranscriptPanel();
  debugLog("[YouTube Digest Content] Transcript panel:", via);

  const startedAt = Date.now();
  const limitSeconds = Math.round(TRANSCRIPT_PANEL_TIMEOUT_MS / 1000);
  let count = 0;
  let stable = 0;
  let previous = -1;
  while (Date.now() - startedAt < TRANSCRIPT_PANEL_TIMEOUT_MS) {
    count = findTranscriptRows().length;
    stable = count > 0 && count === previous ? stable + 1 : 0;
    previous = count;
    reportTranscriptProgress(
      count
        ? `Reading the transcript panel: ${count} lines`
        : `Waiting for YouTube's transcript panel (${Math.round((Date.now() - startedAt) / 1000)}s of ${limitSeconds}s)`,
    );
    if (stable >= TRANSCRIPT_PANEL_STABLE_ROUNDS) break;
    await transcriptSleep(TRANSCRIPT_PANEL_POLL_MS);
  }

  if (!count) {
    return {
      success: false,
      error: "TRANSCRIPT_PANEL_UNAVAILABLE",
      message:
        "Could not open YouTube's transcript panel. Click “Show transcript” under the video, then try again.",
    };
  }

  reportTranscriptProgress(`Collecting captions: ${count} lines`);
  const chunks = await collectTranscriptPanelChunks(languageCode);
  if (!chunks.length) {
    return {
      success: false,
      error: "EMPTY_TRANSCRIPT",
      message: "YouTube's transcript panel opened but produced no text.",
    };
  }

  return {
    success: true,
    via: "transcript-panel",
    payload: { content: chunks, lang: languageCode, availableLangs },
  };
}

// Pure transcript helpers are exposed for the repository's Node tests only.
globalThis.__YTD_CONTENT_TRANSCRIPT_TESTING__ = {
  findTranscriptRows,
  pickCaptionTrack,
  transcriptTimestampToMs,
};
