// Build the Windows Native Messaging Host and stage a verified installer payload.
// Called before the Tauri NSIS build, never on app launch or during development.
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  console.error("This installer preparation requires Windows.");
  process.exit(1);
}
const frontend = fileURLToPath(new URL("../", import.meta.url));
const repo = resolve(frontend, "..");
const config = JSON.parse(readFileSync(join(frontend, "src-tauri", "tauri.conf.json"), "utf8"));
if (config.identifier !== "io.invibe.annyong" || !/^\d+\.\d+\.\d+$/.test(config.version)) {
  throw new Error("Unexpected application identifier or version");
}
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
const args = [
  "build", "--release", "--manifest-path", "../extension/native-host/Cargo.toml",
  "--target-dir", "src-tauri/target",
];
const built = spawnSync(cargo, args, { cwd: frontend, stdio: "inherit", env: process.env });
if (built.error || built.status !== 0) throw new Error("Native Host release build failed");
const exe = join(frontend, "src-tauri", "target", "release", "in-vibe-native-host.exe");
const sha256 = createHash("sha256").update(readFileSync(exe)).digest("hex");
const sourceCommit = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error("Invalid source commit");
const output = join(frontend, "src-tauri", "windows", "native-host-payload");
const scripts = join(output, "scripts");
const runtime = join(output, "native-host-runtime");
mkdirSync(scripts, { recursive: true });
mkdirSync(runtime, { recursive: true });
copyFileSync(exe, join(runtime, "in-vibe-native-host.exe"));
for (const name of ["Auto-Register-Host.ps1", "Configure-DownloadedHost.ps1", "Register-NativeHost.ps1"]) {
  const source = name === "Auto-Register-Host.ps1"
    ? join(frontend, "src-tauri", "windows", name)
    : join(repo, "extension", "scripts", name);
  copyFileSync(source, join(scripts, name));
}
const metadata = {
  version: config.version, source_commit: sourceCommit, sha256,
  protocol_version: 1, snapshot_supported: true,
};
writeFileSync(join(runtime, "HOST-BUILD.json"), JSON.stringify(metadata, null, 2), "utf8");
if (createHash("sha256").update(readFileSync(join(runtime, "in-vibe-native-host.exe"))).digest("hex") !== sha256) {
  throw new Error("Staged Native Host hash mismatch");
}
console.log(`Prepared NSIS Native Host ${config.version}, SHA-256 ${sha256}`);
