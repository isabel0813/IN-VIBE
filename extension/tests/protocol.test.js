import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { validateObservation, youtubeUrl, validStatus } from '../protocol.js';
import '../observer.js';
const id = 'a'.repeat(32), url = 'https://www.youtube.com/watch?v=abcdefghijk';
const pending = { nonce:'nonce',tabId:1,windowId:2,url };
const sender = { id,frameId:0,tab:{id:1,windowId:2},url };
const message = { type:'observation',nonce:'nonce',payload:{kind:'watch',videoId:'abcdefghijk',title:'게임 플레이',playing:true} };
test('PiP-only probes accept only verified watch-page PiP and playing follows the originating video', () => {
  const video = { paused:false, ended:false, seeking:false, readyState:4, playbackRate:1 };
  const player = { querySelector:()=>video, classList:{contains:()=>false} };
  const watch = { getAttribute:()=> 'abcdefghijk', querySelector:s=>s==='#movie_player'?player:{textContent:'게임 플레이'} };
  const doc = { visibilityState:'hidden', pictureInPictureElement:video, title:'게임 플레이 - YouTube',
    querySelector:s=>s.startsWith('ytd')?watch:null };
  const check = { ...pending, pipOnly:true };
  assert.equal(validateObservation(message,sender,id,check),null);
  const payload = AnnyongObserver.read(doc,url,true);
  assert.equal(payload.kind,'pip');
  assert.deepEqual(validateObservation({...message,payload},sender,id,check),payload);
  for (const advertisementClass of ['ad-showing','ad-interrupting']) {
    player.classList.contains = value => value === advertisementClass;
    assert.equal(AnnyongObserver.read(doc,url,true).kind,'unavailable');
  }
  player.classList.contains = () => false;
  video.paused=true;
  assert.equal(AnnyongObserver.read(doc,url,true).playing,false);
  doc.pictureInPictureElement=null;
  assert.equal(AnnyongObserver.read(doc,url,true).kind,'unavailable');
});
test('declarative and recovery injections share one observation listener', async () => {
  const listeners = [];
  const source = await readFile(new URL('../content.js', import.meta.url), 'utf8');
  const context = createContext({
    performance: { now: () => 0 },
    window: { addEventListener() {} },
    document: { addEventListener() {} },
    chrome: { runtime: { onMessage: { addListener: listener => listeners.push(listener) } } },
  });
  runInContext(source, context);
  runInContext(source, context);
  assert.equal(listeners.length, 1);
});
test('accepts only top-level selected YouTube challenge responses', () => {
  assert.deepEqual(validateObservation(message,sender,id,pending), message.payload);
  for (const change of [{id:'b'.repeat(32)},{frameId:1},{url:'https://evil.test/watch?v=abcdefghijk'},{tab:{id:8,windowId:2}}]) assert.equal(validateObservation(message,{...sender,...change},id,pending),null);
  assert.equal(validateObservation({...message,nonce:'old'},sender,id,pending),null);
});
test('binds playback to the current challenge URL after YouTube SPA navigation', () => {
  const previousUrl = 'https://www.youtube.com/watch?v=zyxwvutsrqp';
  const spaSender = { ...sender, url: previousUrl };
  assert.deepEqual(validateObservation(message, spaSender, id, pending), message.payload);
  const stale = { ...message, payload: { ...message.payload, videoId: 'zyxwvutsrqp' } };
  assert.equal(validateObservation(stale, spaSender, id, pending), null);
  assert.equal(validateObservation(message, spaSender, id, { ...pending, url: 'https://www.youtube.com/' }), null);
});
test('rejects length, unexpected fields and video URL mismatches', () => {
  for (const change of [{title:'x'.repeat(401)},{title:'a\nb'},{videoId:'zyxwvutsrqp'},{playing:'true'},{body:'private'}]) assert.equal(validateObservation({...message,payload:{...message.payload,...change}},sender,id,pending),null);
  assert.equal(youtubeUrl('https://www.youtube.com.evil.test/watch'), null);
  assert.equal(validStatus({type:'status',connected:true,collecting:true,generation:-1}),false);
});
test('SPA identity, unsupported Shorts and invisible pages fail closed', () => {
  const unavailable = {kind:'unavailable',videoId:null,title:'',playing:false};
  assert.deepEqual(AnnyongObserver.read({visibilityState:'hidden'},url),unavailable);
  assert.deepEqual(AnnyongObserver.read({visibilityState:'visible'},'https://www.youtube.com/shorts/abcdefghijk'),unavailable);
  assert.equal(AnnyongObserver.locationInfo(url).id,'abcdefghijk');
  assert.equal(AnnyongObserver.locationInfo('https://www.youtube.com/watch?v=bad'),null);
});
test('pause, buffering, seek, ads, changed identity never count as playback', () => {
  const video = {paused:false,ended:false,seeking:false,readyState:4,playbackRate:1};
  let watchId='abcdefghijk', ads=false;
  const watch={getAttribute:()=>watchId,querySelector:selector=>selector==="#movie_player"?player:({textContent:'전자기 유도 강의'})};
  const player={querySelector:()=>video,classList:{contains:()=>ads}};
  const document={visibilityState:'visible',querySelector:selector=>selector.startsWith('ytd') && selector.includes(watchId)?watch:null};
  assert.equal(AnnyongObserver.read(document,url).playing,true);
  for (const [key,value] of [['paused',true],['ended',true],['seeking',true],['readyState',2],['playbackRate',0]]) { const old=video[key]; video[key]=value; assert.equal(AnnyongObserver.read(document,url).playing,false); video[key]=old; }
  ads=true; assert.equal(AnnyongObserver.read(document,url).kind,'unavailable'); ads=false;
  watchId='zyxwvutsrqp'; assert.equal(AnnyongObserver.read(document,url).kind,'unavailable');
});


test('title fallback is SPA-bound and normalizes whitespace without reading page bodies', () => {
  const video={paused:false,ended:false,seeking:false,readyState:4,playbackRate:1};
  const player={querySelector:()=>video,classList:{contains:()=>false}};
  const watch={getAttribute:()=> 'abcdefghijk',querySelector:s=>s==='#movie_player'?player:null};
  let meta='전자기   유도 강의';
  const doc={visibilityState:'visible',title:'(3) 전자기 유도 강의 - YouTube',querySelector:s=>s.startsWith('ytd')?watch:{getAttribute:()=>meta}};
  assert.equal(AnnyongObserver.read(doc,url).title,'전자기 유도 강의');
  meta='old video'; assert.equal(AnnyongObserver.read(doc,url).kind,'unavailable');
});

test('a numeric prefix in the actual video title is preserved',()=>{
  const video={paused:false,ended:false,seeking:false,readyState:4,playbackRate:1};
  const player={querySelector:()=>video,classList:{contains:()=>false}};
  const watch={getAttribute:()=> 'abcdefghijk',querySelector:s=>s==='#movie_player'?player:{textContent:'(2) 전자기 유도 강의'}};
  const doc={visibilityState:'visible',title:'(2) 전자기 유도 강의 - YouTube',querySelector:s=>s.startsWith('ytd')?watch:null};
  assert.equal(AnnyongObserver.read(doc,url).title,'(2) 전자기 유도 강의');
});
