(() => {
  let changedAt = performance.now();
  let previous = "";
  const reset = () => { changedAt = performance.now(); previous = ""; };
  for (const event of ["yt-navigate-start", "yt-navigate-finish", "popstate", "pageshow"]) window.addEventListener(event, reset);
  document.addEventListener("visibilitychange", reset);
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || message?.type !== "observe" || typeof message.nonce !== "string" || message.nonce.length !== 36) return;
    let payload = globalThis.AnnyongObserver.read(document, location.href);
    const key = `${payload.videoId}:${payload.title}`;
    if (previous !== key) { previous = key; changedAt = performance.now(); }
    if (performance.now() - changedAt < 1500) payload = { kind: "unavailable", videoId: null, title: "", playing: false };
    // Only respond to a worker challenge; never open a native port or collect a history.
    void chrome.runtime.sendMessage({ type: "observation", nonce: message.nonce, payload }).catch(() => {});
    reply({ ok: true });
  });
})();
