import test from 'node:test';
import assert from 'node:assert/strict';

const event = () => ({
  listeners: [],
  addListener(fn) { this.listeners.push(fn); },
  emit(...args) { for (const fn of this.listeners) fn(...args); },
});
let instance = 0;
async function harness(run) {
  const originalInterval = globalThis.setInterval;
  const originalNow = Date.now;
  const id = 'abcdefghijklmnopabcdefghijklmnop';
  const tab = { id: 1, windowId: 2, active: true, url: 'https://www.youtube.com/watch?v=abcdefghijk' };
  const state = { collecting: true, clock: 10000, generation: 41, challenges: [], ports: [], windowReads: [], messages: [] };
  let tick;
  const chrome = {
    storage: { local: { get: async () => ({ enabled: true }), set: async () => {} } },
    runtime: {
      id, onMessage: event(), getURL: path => `chrome-extension://${id}/${path}`,
      connectNative() {
        const port = {
          onMessage: event(), onDisconnect: event(),
          postMessage(message) {
            state.messages.push({ port, message });
            if (message.type === 'heartbeat') port.onMessage.emit({ type: 'status', connected: true, collecting: state.collecting, generation: state.generation });
          },
          disconnect() { this.onDisconnect.emit(); },
        };
        state.ports.push(port);
        return port;
      },
    },
    tabs: {
      query: async () => [tab], get: async () => ({ ...tab }),
      sendMessage: async (_, message) => { state.challenges.push(message); },
      onActivated: event(), onRemoved: event(), onUpdated: event(),
    },
    windows: {
      get: async windowId => { state.windowReads.push(windowId); return { state: windowId === 9 ? 'minimized' : 'normal' }; },
      onFocusChanged: event(), onRemoved: event(),
    },
  };
  const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
  const request = (message, sender) => new Promise(resolve => chrome.runtime.onMessage.listeners[0](message, sender, resolve));
  state.reply = () => request({ type: 'observation', nonce: state.challenges.at(-1).nonce,
    payload: { kind: 'watch', videoId: 'abcdefghijk', title: '합성 영상 gameplay', playing: true } },
    { id, frameId: 0, url: tab.url, tab: { id: 1, windowId: 2 } });
  state.snapshots = () => state.messages.filter(entry => entry.message.type === 'snapshot').map(entry => entry.message);
  state.poll = async () => { tick(); await flush(); };
  state.flush = flush;
  state.request = request;
  state.popup = { id, frameId: 0, url: chrome.runtime.getURL('popup.html') };
  state.chrome = chrome;
  state.tab = tab;
  globalThis.chrome = chrome;
  globalThis.setInterval = fn => { tick = fn; return 0; };
  Date.now = () => state.clock;
  try {
    await import(`../worker.js?lifecycle=${++instance}`);
    await flush();
    await run(state);
  } finally {
    await request({ type: 'enable', enabled: false }, state.popup);
    await flush();
    globalThis.setInterval = originalInterval;
    Date.now = originalNow;
    delete globalThis.chrome;
  }
}

test('rejects a response when its tab moved to a different minimized window during the challenge', async () => {
  await harness(async state => {
    state.tab.windowId = 9;
    const result = await state.reply();
    await state.flush();
    assert.equal(result.ok, false);
    assert.deepEqual(state.snapshots().at(-1).observations, []);
  });
});

test('revocation cancels pending observations and prevents further challenges', async () => {
  await harness(async state => {
    state.collecting = false;
    state.ports[0].onMessage.emit({ type: 'status', connected: true, collecting: false, generation: 41 });
    assert.equal((await state.reply()).ok, false);
    const count = state.challenges.length;
    await state.poll();
    assert.equal(state.challenges.length, count);
    assert.equal(state.snapshots().length, 0);
  });
});

test('reconnect resets sequence and rejects responses from the old connection', async () => {
  await harness(async state => {
    const first = state.ports[0];
    first.onDisconnect.emit();
    assert.equal((await state.reply()).ok, false);
    state.clock += 5001;
    state.generation = 42;
    await state.poll();
    assert.equal(state.ports.length, 2);
    const secondMessages = state.messages.filter(entry => entry.port === state.ports[1]);
    assert.equal(secondMessages[0].message.seq, 1);
    first.onMessage.emit({ type: 'status', connected: true, collecting: false, generation: 1 });
    assert.equal((await state.reply()).ok, true);
    await state.flush();
    assert.equal(state.snapshots().at(-1).generation, 42);
    assert.equal(state.snapshots().at(-1).observations.length, 1);
  });
});

test('navigation invalidates pending video data and rejects replay', async () => {
  await harness(async state => {
    state.chrome.tabs.onUpdated.emit(1, { url: 'https://www.youtube.com/watch?v=zyxwvutsrqp' });
    assert.equal((await state.reply()).ok, false);
    await state.poll();
    assert.equal((await state.reply()).ok, true);
    assert.equal((await state.reply()).ok, false);
    await state.flush();
    assert.equal(state.snapshots().length, 1);
  });
});
