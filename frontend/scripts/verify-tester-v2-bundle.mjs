import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { brotliDecompressSync } from "node:zlib";

const root = resolve(process.argv[2] ?? ".");
const release = join(root, "frontend", "src-tauri", "target", "release");
const web = join(root, "frontend", "dist");
const app = readFileSync(join(release, "in-vibe.exe"));
const installer = readFileSync(join(release, "nsis", "x64", "installer.nsi"), "utf8");
assert.match(installer, /!define PRODUCTNAME "Mobonyong Tester Beta"/);
assert.match(installer, /!define BUNDLEID "io\.invibe\.annyong\.beta"/);
assert.match(installer, /!define VERSION "0\.3\.8"/);
assert.match(installer, /tester-beta\.nsh/);
assert.match(installer, /beta-host\\in-vibe-native-host\.exe/);
assert.match(installer, /!insertmacro NSIS_HOOK_POSTINSTALL/);
assert.match(installer, /!insertmacro NSIS_HOOK_PREUNINSTALL/);
const hooks = readFileSync(join(root, "frontend", "src-tauri", "installer", "tester-beta.nsh"), "utf8");
assert.ok(hooks.includes("Software\\Google\\Chrome\\NativeMessagingHosts\\io.invibe.annyong.youtube"));
assert.match(hooks, /ExecWait .*--write-beta-manifest/);
assert.ok(hooks.includes('WriteRegStr HKCU "${MOBONYONG_HOST_KEY}" "" "${MOBONYONG_MANIFEST}"'));
assert.ok(app.includes("io.invibe.annyong.beta"));
assert.ok(app.includes("connect-src ipc: http://ipc.localhost https://api.mobonyong.com"));

const index = readFileSync(join(web, "index.html"), "utf8");
const entry = index.match(/src="(\/assets\/[^"/]+\.js)"/)?.[1];
assert.ok(entry);
const js = readFileSync(join(web, entry.slice(1)));
const text = js.toString("utf8");
assert.match(text, /firstMs:(?:6e4|60000),secondMs:(?:3e5|300000),ultimateMs:(?:6e5|600000)/);
assert.ok(text.includes("도 시험 범위야? 나만 공지 못 봤네."));
assert.ok(text.includes("보다가 과제 까먹은 거 아니지?"));
assert.ok(text.includes("키보드나 마우스 입력이 없으면 5분, 10분, 15분에 확인해요."));
assert.ok(text.includes("https://api.mobonyong.com"));
assert.ok(!text.includes("http://127.0.0.1:8010"));

const build = join(release, "build");
const embedded = readdirSync(build).some(dir => {
  const assets = join(build, dir, "out", "tauri-codegen-assets");
  if (!dir.startsWith("in-vibe-") || !existsSync(assets)) return false;
  return readdirSync(assets).some(asset => {
    const encoded = readFileSync(join(assets, asset));
    let decoded = encoded;
    try { decoded = brotliDecompressSync(encoded, { maxOutputLength: 16 * 1024 * 1024 }); } catch {}
    return js.equals(decoded) && app.includes(encoded);
  });
});
assert.ok(embedded, "The matching Tester Beta web entry is embedded in the installer application");

const sandbox = mkdtempSync(join(tmpdir(), "mobonyong-beta-v3-host-"));
const host = join(sandbox, "in-vibe-native-host.exe");
const name = "io.invibe.annyong.youtube";
const manifestPath = join(sandbox, `${name}.json`);
try {
  copyFileSync(join(release, "in-vibe-native-host.exe"), host);
  const run = (arg) => spawnSync(host, [arg], { windowsHide: true, input: Buffer.alloc(0), timeout: 8000 });
  assert.equal(run("--write-beta-manifest").status, 0);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const origin = "chrome-extension://nndjojfhmpbolfifcfdcpalcloanppod/";
  assert.deepEqual(manifest.allowed_origins, [origin]);
  assert.equal(manifest.name, name);
  assert.equal(manifest.path, host);
  // Empty stdin validates the origin and exits before opening a live app pipe.
  assert.equal(run(origin).status, 0);
  assert.equal(run("chrome-extension://ohajfkkemocajnjlbnogdmoominkejci/").status, 1);
  assert.equal(run("chrome-extension://medfdpmihlebgmbcocmifcafedbdcoji/").status, 1);
} finally {
  rmSync(host, { force: true });
  rmSync(manifestPath, { force: true });
  rmdirSync(sandbox);
}

console.log("Tester Beta bundle, embedded web entry, Windows 5/10/15-minute guidance, YouTube 1/5/10-minute stages and installer Host origin passed.");
