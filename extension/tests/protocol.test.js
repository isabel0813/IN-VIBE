import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateObservation, youtubeUrl, validStatus } from '../protocol.js';
import '../observer.js';
const id = 'a'.repeat(32), url = 'https://www.youtube.com/watch?v=abcdefghijk';
const pending = { nonce:'nonce',tabId:1,windowId:2,url };
const sender = { id,frameId:0,tab:{id:1,windowId:2},url };
const message = { type:'observation',nonce:'nonce',payload:{kind:'watch',videoId:'abcdefghijk',title:'게임 플레이',playing:true} };
test('accepts only top-level selected YouTube challenge responses', () => {
  assert.deepEqual(validateObservation(message,sender,id,pending), message.payload);
  for (const change of [{id:'b'.repeat(32)},{frameId:1},{url:'https://evil.test/watch?v=abcdefghijk'},{tab:{id:8,windowId:2}}]) assert.equal(validateObservation(message,{...sender,...change},id,pending),null);
  assert.equal(validateObservation({...message,nonce:'old'},sender,id,pending),null);
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
  const watch={getAttribute:()=>watchId,querySelector:()=>({textContent:'전자기 유도 강의'})};
  const player={querySelector:()=>video,classList:{contains:()=>ads}};
  const document={visibilityState:'visible',querySelector:selector=>selector.startsWith('ytd')?watch:player};
  assert.equal(AnnyongObserver.read(document,url).playing,true);
  for (const [key,value] of [['paused',true],['ended',true],['seeking',true],['readyState',2],['playbackRate',0]]) { const old=video[key]; video[key]=value; assert.equal(AnnyongObserver.read(document,url).playing,false); video[key]=old; }
  ads=true; assert.equal(AnnyongObserver.read(document,url).kind,'unavailable'); ads=false;
  watchId='zyxwvutsrqp'; assert.equal(AnnyongObserver.read(document,url).kind,'unavailable');
});
