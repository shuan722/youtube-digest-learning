/**
 * PAGE BRIDGE
 *
 * Runs in the YouTube page's own JavaScript world, which the content script
 * cannot reach: content scripts live in an isolated world where
 * window.ytInitialPlayerResponse and #movie_player.getPlayerResponse() are
 * invisible. Parsing them out of <script> tags is not an option either,
 * because YouTube is a single-page app and those tags keep the data of
 * whichever video was loaded first.
 *
 * The bridge answers requests with the current video's caption tracks. The
 * payload crosses worlds as a JSON string so no object has to survive a
 * structured clone.
 */
(() => {
  const REQUEST_EVENT = "ytd-digest-bridge-request";
  const RESPONSE_EVENT = "ytd-digest-bridge-response";

  if (window.__ytdDigestBridgeInstalled) return;
  window.__ytdDigestBridgeInstalled = true;

  const readCaptionTracks = () => {
    try {
      const player =
        document.getElementById("movie_player")?.getPlayerResponse?.() ??
        window.ytInitialPlayerResponse;
      const renderer = player?.captions?.playerCaptionsTracklistRenderer;
      const tracks = renderer?.captionTracks ?? [];
      return {
        videoId: player?.videoDetails?.videoId || "",
        durationSeconds: Number(player?.videoDetails?.lengthSeconds) || 0,
        author: player?.videoDetails?.author || "",
        publishedAt:
          player?.microformat?.playerMicroformatRenderer?.publishDate || "",
        tracks: tracks.map((track) => ({
          baseUrl: track?.baseUrl || "",
          languageCode: track?.languageCode || "",
          // "asr" marks an auto-generated track.
          kind: track?.kind || "",
        })),
      };
    } catch (error) {
      return {
        videoId: "",
        durationSeconds: 0,
        author: "",
        publishedAt: "",
        tracks: [],
        error: error.message,
      };
    }
  };

  const respond = () => {
    window.dispatchEvent(
      new CustomEvent(RESPONSE_EVENT, {
        detail: JSON.stringify(readCaptionTracks()),
      }),
    );
  };

  window.addEventListener(REQUEST_EVENT, respond);
  // Answer the request that caused this script to be injected.
  respond();
})();
