import { HOST, youtubeUrl, validateObservation, validStatus } from "./protocol.js";
let enabled = false, port = null, pending = null, epoch = 0, seq = 0, retryAt = 0;
let status = { type: "status", connected: false, collecting: false, generation: 0 };
const loaded = chrome.storage.local.get("enabled").then(value => { enabled = value.enabled === true; });
function send(type, extra = {}) {
  if (!port) return;
  try { port.postMessage({ version: 1, type, generation: status.generation, seq: ++seq, ...extra }); }
  catch { disconnect(); }
}
function clear() { epoch++; pending = null; send("clear"); }
function disconnect() {
  pending = null; epoch++; status = { type: "status", connected: false, collecting: false, generation: 0 };
  const old = port; port = null; old?.disconnect(); retryAt = Date.now() + 5000;
}
function connect() {
  if (port || !enabled || Date.now() < retryAt) return;
  try {
    const current = chrome.runtime.connectNative(HOST); port = current; seq = 0;
    current.onMessage.addListener(value => {
      if (port !== current) return;
      if (!validStatus(value)) { disconnect(); return; }
      if (!value.collecting || value.generation !== status.generation) { pending = null; epoch++; }
      status = { type: "status", connected: value.connected, collecting: value.collecting, generation: value.generation };
    });
    current.onDisconnect.addListener(() => { void chrome.runtime.lastError; if (port === current) disconnect(); });
  } catch { disconnect(); }
}
async function tick() {
  await loaded;
  if (!enabled) return;
  connect(); send("heartbeat");
  if (!status.collecting || !status.connected || pending) return;
  const stamp = epoch;
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const window = tab && await chrome.windows.get(tab.windowId);
    if (stamp !== epoch) return;
    if (!tab || !window.focused || window.state === "minimized" || !youtubeUrl(tab.url)) { clear(); return; }
    pending = { nonce: crypto.randomUUID(), tabId: tab.id, windowId: tab.windowId, url: tab.url, epoch: stamp, expires: Date.now() + 2000 };
    await chrome.tabs.sendMessage(tab.id, { type: "observe", nonce: pending.nonce }, { frameId: 0 });
  } catch { clear(); }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  void (async () => {
    await loaded;
    if (sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL("popup.html") && !sender.tab) {
      if (message?.type === "enable" && typeof message.enabled === "boolean") {
        enabled = message.enabled; await chrome.storage.local.set({ enabled });
        if (!enabled) { clear(); disconnect(); } else { retryAt = 0; connect(); send("heartbeat"); }
      }
      reply({ enabled, ...status, extensionId: chrome.runtime.id }); return;
    }
    const challenge = pending;
    const observation = enabled && status.collecting ? validateObservation(message, sender, chrome.runtime.id, challenge) : null;
    if (!observation || challenge.expires < Date.now()) { reply({ ok: false }); return; }
    pending = null; // consume nonce before any asynchronous recheck
    const tab = await chrome.tabs.get(challenge.tabId);
    const window = await chrome.windows.get(challenge.windowId);
    if (!enabled || !status.collecting || epoch !== challenge.epoch || !tab.active || tab.url !== challenge.url || !window.focused || window.state === "minimized") { reply({ ok: false }); return; }
    send("observation", { observation }); reply({ ok: true });
  })().catch(() => { clear(); reply({ ok: false }); });
  return true;
});
chrome.tabs.onActivated.addListener(clear);
chrome.tabs.onRemoved.addListener(clear);
chrome.tabs.onUpdated.addListener((_id, change) => { if (change.url || change.status === "loading") clear(); });
chrome.windows.onFocusChanged.addListener(clear);
chrome.windows.onRemoved.addListener(clear);
setInterval(() => {
  if (pending && pending.expires < Date.now()) clear();
  void tick();
}, 1000);
void loaded.then(tick);
