import test from 'node:test';
import assert from 'node:assert/strict';
test('samples selected tabs in multiple unfocused windows, atomically excluding pause/minimize/inactive tabs', async () => {
  const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);},emit(...a){for(const fn of this.listeners)fn(...a);}});
  const id='a'.repeat(32), snapshots=[];
  const tabs=[{id:1,windowId:11,active:true,url:'https://www.youtube.com/watch?v=abcdefghijk'}, {id:2,windowId:22,active:true,url:'https://www.youtube.com/watch?v=zyxwvutsrqp'}];
  let interval, paused=false, minimized=false, inactive=false;
  const port={onMessage:event(),onDisconnect:event(),disconnect(){this.onDisconnect.emit();},postMessage(m){if(m.type==='heartbeat')this.onMessage.emit({type:'status',connected:true,collecting:true,generation:42}); if(m.type==='snapshot')snapshots.push(m);}};
  globalThis.chrome={storage:{local:{get:async()=>({enabled:true})}},runtime:{id,getURL:p=>`chrome-extension://${id}/${p}`,onMessage:event(),connectNative:()=>port},
    tabs:{query:async query=>{assert.equal(query.active,true);assert.equal(query.lastFocusedWindow,undefined);return tabs;},get:async tabId=>({...tabs.find(t=>t.id===tabId),active:!inactive}),sendMessage:async(tabId,m)=>{
      const tab=tabs.find(t=>t.id===tabId);
      const payload={kind:'watch',videoId:tabId===1?'abcdefghijk':'zyxwvutsrqp',title:tabId===1?'gameplay':'lecture',playing:!(paused&&tabId===2)};
      chrome.runtime.onMessage.emit({type:'observation',nonce:m.nonce,payload},{id,frameId:0,url:tab.url,tab},()=>{});
    },onActivated:event(),onRemoved:event(),onUpdated:event()},
    windows:{get:async windowId=>({focused:false,state:minimized&&windowId===22?'minimized':'normal'}),onFocusChanged:event(),onRemoved:event()}};
  const old=globalThis.setInterval;
  globalThis.setInterval=fn=>{interval=fn;return 0;};
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  try {
    await import('../worker.js'); await flush(); await flush();
    assert.equal(snapshots.at(-1).observations.length,2);
    paused=true; interval(); await flush(); await flush();
    assert.equal(snapshots.at(-1).observations.length,1);
    paused=false; minimized=true; interval(); await flush(); await flush();
    assert.equal(snapshots.at(-1).observations.length,1);
    inactive=true; interval(); await flush(); await flush();
    assert.deepEqual(snapshots.at(-1).observations,[]);
  } finally {globalThis.setInterval=old;delete globalThis.chrome;}
});
