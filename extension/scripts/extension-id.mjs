import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url)));
if (!manifest.key) throw new Error('A stable public key is required.');
console.log([...createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest().subarray(0,16)].map(byte=>String.fromCharCode(97+(byte>>4),97+(byte&15))).join(''));
