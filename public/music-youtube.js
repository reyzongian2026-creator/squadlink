(() => {
  "use strict";
  const channel = "squadlink:music";
  const videoId = new URLSearchParams(location.search).get("video") || "";
  const status = document.getElementById("video-status");
  let viewer, parentOrigin, ready = false, visible = false, hasPlayed = false;
  let baseTime = 0, basePosition = 0;
  const validPosition = value => Number.isFinite(value) && value >= 0;
  function send(action, values = {}) {
    if (parentOrigin) parent.postMessage({channel, action, ...values}, parentOrigin);
  }
  function unavailable() {
    status.hidden = false;
    status.textContent = "Video no disponible.";
    send("unavailable");
  }
  function duration() {
    const seconds = viewer?.getDuration();
    if (Number.isFinite(seconds) && seconds > 0) send("duration", {seconds});
  }
  function align(position) {
    const limit = viewer.getDuration();
    if (limit > 0) position = Math.min(position, limit);
    if (Math.abs(viewer.getCurrentTime() - position) > 2) viewer.seekTo(position, true);
  }
  function start() {
    if (!/^[\w-]{11}$/.test(videoId)) { unavailable(); return; }
    window.onYouTubeIframeAPIReady = () => {
      viewer = new YT.Player("video", {
        width: "100%", height: "100%", videoId,
        playerVars: {origin: location.origin, playsinline: 1, controls: 1, autoplay: 0},
        events: {
          onReady: () => {
            ready = true;
            viewer.getIframe().title = "Video de YouTube";
            status.hidden = true;
            duration(); send("ready");
          },
          onAutoplayBlocked: () => send("blocked"),
          onError: unavailable,
          onStateChange: event => {
            if (event.data === YT.PlayerState.PLAYING) {
              if (!visible) { viewer.pauseVideo(); return; }
              if (!hasPlayed) align(basePosition + (performance.now() - baseTime) / 1000);
              hasPlayed = true; duration(); send("playing");
            }
            if (event.data === YT.PlayerState.ENDED && hasPlayed && visible) send("ended");
          }
        }
      });
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = unavailable;
    document.head.append(script);
  }
  addEventListener("message", event => {
    if (parent === window || event.source !== parent || ![location.origin, "squad://app"].includes(event.origin)) return;
    const data = event.data;
    if (data?.channel !== channel || (parentOrigin && parentOrigin !== event.origin)) return;
    if (data.action === "connect" && !parentOrigin) {
      parentOrigin = event.origin;
      start(); return;
    }
    if (!ready || event.origin !== parentOrigin) return;
    if (["volume", "play"].includes(data.action) && Number.isFinite(data.volume)) {
      viewer.setVolume(Math.max(0, Math.min(100, data.volume)));
    }
    if (data.action === "pause") {
      visible = false;
      viewer.pauseVideo();
    } else if (data.action === "play" && validPosition(data.position)) {
      visible = true;
      basePosition = data.position; baseTime = performance.now();
      align(data.position); viewer.playVideo();
    } else if (data.action === "sync" && visible && validPosition(data.position)) {
      basePosition = data.position; baseTime = performance.now();
      if (viewer.getPlayerState() === YT.PlayerState.PLAYING) align(data.position);
    }
  });
})();
