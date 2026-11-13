export const HOST = "io.invibe.annyong.youtube";
export function youtubeUrl(value) {
  try { const url = new URL(value); return url.origin === "https://www.youtube.com" ? url : null; } catch { return null; }
}
export function validateObservation(message, sender, extensionId, pending) {
  if (!pending || sender.id !== extensionId || sender.frameId !== 0 || sender.tab?.id !== pending.tabId || sender.tab?.windowId !== pending.windowId || sender.url !== pending.url || !youtubeUrl(sender.url)) return null;
  if (!message || Object.keys(message).sort().join() !== "nonce,payload,type" || message.type !== "observation" || message.nonce !== pending.nonce) return null;
  const p = message.payload;
  if (!p || Object.keys(p).sort().join() !== "kind,playing,title,videoId" || typeof p.playing !== "boolean" || typeof p.title !== "string" || p.title.length > 400 || /[\u0000-\u001f\u007f]/.test(p.title)) return null;
  if (p.kind === "unavailable") return p.videoId === null && p.title === "" && !p.playing ? p : null;
  const url = youtubeUrl(sender.url);
  if (p.kind !== "watch" || !/^[A-Za-z0-9_-]{11}$/.test(p.videoId) || !p.title.trim() || url.pathname !== "/watch" || url.searchParams.get("v") !== p.videoId) return null;
  return { kind: p.kind, videoId: p.videoId, title: p.title, playing: p.playing };
}
export function validStatus(value) {
  return value?.type === "status" && typeof value.connected === "boolean" && typeof value.collecting === "boolean" && Number.isSafeInteger(value.generation) && value.generation >= 0;
}
