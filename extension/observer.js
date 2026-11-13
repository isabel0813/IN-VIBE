// Isolated content-script world. Reads only video identity/title/player state.
((scope) => {
  const idPattern = /^[A-Za-z0-9_-]{11}$/;
  function locationInfo(href) {
    try {
      const url = new URL(href);
      if (url.origin !== "https://www.youtube.com") return null;
      const shorts = /^\/shorts\/([^/]+)$/.exec(url.pathname);
      const id = shorts ? shorts[1] : url.pathname === "/watch" ? url.searchParams.get("v") : null;
      return id && idPattern.test(id) ? { id, kind: shorts ? "shorts" : "watch" } : null;
    } catch { return null; }
  }
  function read(document, href) {
    const info = locationInfo(href);
    const unavailable = { kind: "unavailable", videoId: null, title: "", playing: false };
    // Shorts can preload multiple players. Never guess the current player/title.
    if (!info || info.kind === "shorts" || document.visibilityState !== "visible") return unavailable;
    const watch = document.querySelector('ytd-watch-flexy[video-id]');
    const player = document.querySelector('#movie_player');
    const video = player?.querySelector('video');
    const title = watch?.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string')?.textContent?.trim();
    if (watch?.getAttribute('video-id') !== info.id || !video || !title || title.length > 400 || player.classList.contains('ad-showing')) return unavailable;
    return { kind: "watch", videoId: info.id, title,
      playing: !video.paused && !video.ended && !video.seeking && video.readyState >= 3 && video.playbackRate > 0 };
  }
  scope.AnnyongObserver = Object.freeze({ locationInfo, read });
})(globalThis);
