import test from "node:test";
import assert from "node:assert/strict";

test("worker gates native access, selected tab, window focus, consent and disconnect", async () => {
  const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);},emit(...args){for(const fn of this.listeners) fn(...args);}});
  const sent=[], challenges=[];
  const id="abcdefghijklmnopabcdefghijklmnop";
  let focused=true, minimized=false, active=true, interval;
  const port={onMessage:event(),onDisconnect:event(),postMessage(m){sent.push(m); if(m.type==="heartbeat") this.onMessage.emit({type:"status",connected:true,collecting:true,generation:42});},disconnect(){this.onDisconnect.emit();}};
  const tab={id:1,windowId:2,url:"https://www.youtube.com/watch?v=abcdefghijk"};
  const nativeConnections=[];
  globalThis.chrome={storage:{local:{get:async()=>({enabled:false}),set:async()=>{}}},runtime:{id,onMessage:event(),getURL:p=>`chrome-extension://${id}/${p}`,connectNative(name){nativeConnections.push(name);return port;}},
    tabs:{query:async()=>[tab],get:async()=>({...tab,active}),sendMessage:async(_,m)=>challenges.push(m),onActivated:event(),onRemoved:event(),onUpdated:event()},
    windows:{get:async()=>({focused,state:minimized?"minimized":"normal"}),onFocusChanged:event(),onRemoved:event()}};
  const oldInterval=globalThis.setInterval;
  globalThis.setInterval=fn=>{interval=fn;return 0;};
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  const request=(message,sender)=>new Promise(resolve=>chrome.runtime.onMessage.listeners[0](message,sender,resolve));
  const popup={id,url:chrome.runtime.getURL("popup.html")};
  const sender={id,url:tab.url,frameId:0,tab};
  try {
    await import("../worker.js"); await flush();
    assert.equal(nativeConnections.length,0);
    await request({type:"enable",enabled:true},sender); assert.equal(nativeConnections.length,0);
    await request({type:"enable",enabled:true},popup);
    interval(); await flush(); assert.equal(challenges.length,1);
    const payload={kind:"watch",videoId:"abcdefghijk",title:"게임 플레이",playing:true};
    const observation={type:"observation",nonce:challenges.at(-1).nonce,payload};
    assert.equal((await request(observation,sender)).ok,true);
    assert.equal(sent.filter(m=>m.type==="observation").length,1);
    assert.equal((await request(observation,sender)).ok,false); // replay
    interval(); await flush(); active=false; chrome.tabs.onActivated.emit();
    assert.equal((await request({...observation,nonce:challenges.at(-1).nonce},sender)).ok,false);
    active=true; focused=false; chrome.windows.onFocusChanged.emit(); interval(); await flush();
    assert.equal(sent.at(-1).type,"clear");
    focused=true; minimized=true; interval(); await flush(); assert.equal(sent.at(-1).type,"clear");
    minimized=false; await request({type:"enable",enabled:false},popup);
    const count=challenges.length; interval(); await flush(); assert.equal(challenges.length,count);
    assert.equal((await request({type:"status"},popup)).connected,false);
    assert.equal(sent.filter(m=>m.type==="observation").length,1);
  } finally {globalThis.setInterval=oldInterval;delete globalThis.chrome;}
});
