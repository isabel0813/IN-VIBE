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
  function read(document, href, pipOnly = false) {
    const info = locationInfo(href);
    const unavailable = { kind: "unavailable", videoId: null, title: "", playing: false };
    // Shorts can preload multiple players. Never guess the current player/title.
    if (!info || info.kind === "shorts") return unavailable;
    if (document.visibilityState !== "visible" && !document.pictureInPictureElement) return unavailable;
    const watch = document.querySelector(`ytd-watch-flexy[video-id="${info.id}"]`);
    const player = watch?.querySelector('#movie_player');
    const video = player?.querySelector('video');
    const pip = !!video && document.pictureInPictureElement === video;
    if (!pip && (pipOnly || document.visibilityState !== "visible")) return unavailable;
    const titleElement = watch?.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string, h1.ytd-watch-metadata');
    const normalize = value => value?.replace(/\s+/g, ' ').trim();
    // The structured video name is a fallback only when the SPA page identity
    // and document title agree, avoiding a stale title during navigation.
    const metadata = document.querySelector('meta[itemprop="name"]')?.getAttribute('content');
    const pageTitle = normalize(document.title?.replace(/ - YouTube$/, ''));
    const pageTitles = [pageTitle, pageTitle?.replace(/^\(\d+\)\s*/, '')].filter(Boolean);
    const title = normalize(titleElement?.textContent) || (pageTitles.includes(normalize(metadata)) ? normalize(metadata) : null);
    if (title && pageTitles.length && !pageTitles.includes(title)) return unavailable;
    if (watch?.getAttribute('video-id') !== info.id || !video || !title || title.length > 400 || player.classList.contains('ad-showing')) return unavailable;
    return { kind: pip ? "pip" : "watch", videoId: info.id, title,
      playing: !video.paused && !video.ended && !video.seeking && video.readyState >= 3 && video.playbackRate > 0 };
  }
  scope.AnnyongObserver = Object.freeze({ locationInfo, read });
})(globalThis);
