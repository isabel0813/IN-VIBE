import { HOST, youtubeUrl, validateObservation, validStatus } from "./protocol.js";
let enabled = false, port = null, epoch = 0, seq = 0, retryAt = 0, reading = false;
const pending = new Map();
let status = { type: "status", connected: false, collecting: false, generation: 0 };
const loaded = chrome.storage.local.get("enabled").then(value => { enabled = value.enabled === true; });
function send(type, extra = {}) {
  if (!port) return;
  try { port.postMessage({ version: 1, type, generation: status.generation, seq: ++seq, ...extra }); }
  catch { disconnect(); }
}
function cancel() {
  epoch++;
  for (const challenge of pending.values()) challenge.finish(null);
  pending.clear();
}
function clear() { cancel(); send("clear"); }
function disconnect() {
  cancel(); status = { type: "status", connected: false, collecting: false, generation: 0 };
  const old = port; port = null; old?.disconnect(); retryAt = Date.now() + 5000;
}
function connect() {
  if (port || !enabled || Date.now() < retryAt) return;
  try {
    const current = chrome.runtime.connectNative(HOST); port = current; seq = 0;
    current.onMessage.addListener(value => {
      if (port !== current) return;
      if (!validStatus(value)) { disconnect(); return; }
      if (!value.collecting || value.generation !== status.generation) cancel();
      status = { type: "status", connected: value.connected, collecting: value.collecting, generation: value.generation };
    });
    current.onDisconnect.addListener(() => { void chrome.runtime.lastError; if (port === current) disconnect(); });
  } catch { disconnect(); }
}
async function stillEligible(challenge, pip = false) {
  const tab = await chrome.tabs.get(challenge.tabId);
  const window = await chrome.windows.get(challenge.windowId);
  return enabled && status.collecting && epoch === challenge.epoch && tab.windowId === challenge.windowId && tab.url === challenge.url && (pip || (tab.active && window.state !== "minimized"));
}
async function sendChallenge(challenge) {
  const { nonce, tabId } = challenge;
  const message = challenge.pipOnly ? { type: "observe", nonce, pipOnly: true } : { type: "observe", nonce };
  try {
    await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
  } catch (error) {
    if (error?.message !== "Could not establish connection. Receiving end does not exist.") throw error;
    if (challenge.pipOnly) { challenge.finish(null); return; }
    // Existing documents may lack a listener after the extension reloads.
    if (!pending.has(nonce) || !await stillEligible(challenge) || !pending.has(nonce)) {
      challenge.finish(null);
      return;
    }
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ["observer.js", "content.js"] });
    if (pending.has(nonce)) await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
  }
}
function observe(tab, stamp, pipOnly = false) {
  return new Promise(resolve => {
    const nonce = crypto.randomUUID();
    const timer = setTimeout(() => finish(null), 1800);
    function finish(value) { clearTimeout(timer); pending.delete(nonce); resolve(value); }
    const challenge = { nonce, tabId: tab.id, windowId: tab.windowId, url: tab.url, epoch: stamp, pipOnly, finish };
    pending.set(nonce, challenge);
    void sendChallenge(challenge).catch(() => finish(null));
  });
}
async function tick() {
  await loaded;
  if (!enabled) return;
  connect(); send("heartbeat");
  if (!status.collecting || !status.connected || reading) return;
  reading = true;
  const stamp = epoch;
  try {
    // active is per-window. Focus is deliberately not required for split screens.
    const tabs = await chrome.tabs.query({ active: true, url: "https://www.youtube.com/*" });
    const eligible = [];
    for (const tab of tabs) {
      const window = await chrome.windows.get(tab.windowId);
      if (window.state !== "minimized" && youtubeUrl(tab.url)) eligible.push(tab);
    }
    if (stamp !== epoch) return;
    // Four windows keep worst-case UTF-8 frames below the native 8192-byte limit.
    const ordinary = eligible.slice(0, 4);
    const ids = new Set(ordinary.map(tab => tab.id));
    const pipCandidates = (await chrome.tabs.query({ url: "https://www.youtube.com/*" }))
      .filter(tab => !ids.has(tab.id) && youtubeUrl(tab.url)?.pathname === "/watch").slice(0, 12);
    if (stamp !== epoch) return;
    const observations = await Promise.all([
      ...ordinary.map(tab => observe(tab, stamp)),
      ...pipCandidates.map(tab => observe(tab, stamp, true)),
    ]);
    const playing = observations.filter(o => o?.playing);
    const pip = playing.find(o => o.kind === "pip");
    if (stamp === epoch && enabled && status.collecting) send("snapshot", {
      observations: (pip ? [pip, ...playing.filter(o => o.videoId !== pip.videoId)] : playing).slice(0, 4),
    });
  } catch { clear(); }
  finally { reading = false; }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  void (async () => {
    await loaded;
    if (sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL("popup.html") && (sender.frameId === undefined || sender.frameId === 0)) {
      if (message?.type === "enable" && typeof message.enabled === "boolean") {
        enabled = message.enabled; await chrome.storage.local.set({ enabled });
        if (!enabled) { clear(); disconnect(); } else { retryAt = 0; connect(); send("heartbeat"); }
      }
      reply({ enabled, ...status, extensionId: chrome.runtime.id }); return;
    }
    const challenge = pending.get(message?.nonce);
    const observation = enabled && status.collecting ? validateObservation(message, sender, chrome.runtime.id, challenge) : null;
    if (!observation) { reply({ ok: false }); return; }
    pending.delete(challenge.nonce); // consume before async validation, rejecting replay
    try {
      const valid = await stillEligible(challenge, observation.kind === "pip");
      challenge.finish(valid ? observation : null); reply({ ok: valid });
    } catch { challenge.finish(null); reply({ ok: false }); }
  })().catch(() => { clear(); reply({ ok: false }); });
  return true;
});
chrome.tabs.onActivated.addListener(clear);
chrome.tabs.onRemoved.addListener(clear);
chrome.tabs.onUpdated.addListener((_id, change) => { if (change.url || change.status === "loading") clear(); });
chrome.windows.onFocusChanged.addListener(clear);
chrome.windows.onRemoved.addListener(clear);
setInterval(() => void tick(), 1000);
void loaded.then(tick);
