// Actual Windows EXE protocol smoke test. No registry writes and no activity observations.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const manifest=JSON.parse(await readFile(new URL("../.local/native-host/io.invibe.annyong.youtube.json",import.meta.url),"utf8"));
function run(origin,input) {
  return new Promise((resolve,reject)=>{
    const child=spawn(manifest.path,[origin],{windowsHide:true,stdio:["pipe","pipe","pipe"]});
    const output=[]; const errors=[];
    const timer=setTimeout(()=>{child.kill();reject(new Error("host timeout"));},5000);
    child.on("error",reject);child.stdout.on("data",b=>output.push(b));child.stderr.on("data",b=>errors.push(b));
    child.stdin.on("error",()=>{});child.stdin.end(input);
    child.on("exit",code=>{clearTimeout(timer);resolve({code,bytes:Buffer.concat(output),errors:Buffer.concat(errors)});});
  });
}
function frame(value){const bytes=Buffer.from(JSON.stringify(value));const length=Buffer.alloc(4);length.writeUInt32LE(bytes.length);return Buffer.concat([length,bytes]);}
const heartbeat=frame({version:1,type:"heartbeat",generation:0,seq:1});
const good=await run(manifest.allowed_origins[0],heartbeat);
assert.equal(good.code,0);assert.equal(good.errors.length,0);assert.equal(good.bytes.readUInt32LE(),good.bytes.length-4);
const status=JSON.parse(good.bytes.subarray(4));assert.equal(status.type,"status");assert.equal(typeof status.connected,"boolean");
assert.equal((await run("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/",heartbeat)).code,1);
assert.equal((await run(manifest.allowed_origins[0],Buffer.from([255,255,255,255]))).code,1);
assert.equal((await run(manifest.allowed_origins[0],Buffer.concat([heartbeat,heartbeat]))).code,1);
console.log("Native EXE: framed heartbeat, exclusive origin, frame bound, sequence replay checks passed; app connected:",status.connected);
