import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
test("NSIS hook is enabled for per-user installation", () => {
  const config = JSON.parse(read("../../frontend/src-tauri/tauri.conf.json"));
  assert.equal(config.bundle.windows.nsis.installMode, "currentUser");
  assert.equal(config.bundle.windows.nsis.installerHooks, "./windows/native-host-hooks.nsh");
});
test("installer bundles and executes checked host scripts", () => {
  const hook = read("../../frontend/src-tauri/windows/native-host-hooks.nsh");
  const prepare = read("../../frontend/scripts/prepare-installer-host.mjs");
  for (const file of ["in-vibe-native-host.exe", "HOST-BUILD.json", "Auto-Register-Host.ps1", "Configure-DownloadedHost.ps1", "Register-NativeHost.ps1"]) {
    assert.ok(hook.includes(file), `NSIS missing ${file}`);
    assert.ok(prepare.includes(file), `payload missing ${file}`);
  }
  assert.match(hook, /NSIS_HOOK_POSTINSTALL/);
  assert.match(hook, /nsExec::ExecToStack/);
  assert.match(hook, /DetailPrint "\$1"/);
  assert.match(read("../../frontend/scripts/desktop.mjs"), /prepare-installer-host\.mjs/);
});
test("auto-register only accepts the official or existing development extension", () => {
  const script = read("../../frontend/src-tauri/windows/Auto-Register-Host.ps1");
  assert.match(script, /nndjojfhmpbolfifcfdcpalcloanppod/);
  assert.match(script, /ohajfkkemocajnjlbnogdmoominkejci/);
  assert.match(script, /Unknown extension origin/);
  assert.match(script, /allowed_origins\.Count -ne 1/);
  assert.doesNotMatch(script, /allowed_origins.*\*/);
});

function simulateRegistration(scenario, channel, expected) {
  const temp = realpathSync(tmpdir());
  const fixture = mkdtempSync(join(temp, "mobonyong-auto-register-"));
  try {
    const result = spawnSync("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      fileURLToPath(new URL("./fixtures/native-host-auto-register.ps1", import.meta.url)),
      "-Repo", fileURLToPath(new URL("../../", import.meta.url)),
      "-Fixture", fixture, "-Scenario", scenario, "-Channel", channel, "-Expected", expected,
    ], { encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    assert.ok(realpathSync(fixture).startsWith(join(temp, "mobonyong-auto-register-")) && fixture.startsWith(temp + sep));
    rmSync(fixture, { recursive: true, force: true });
  }
}

const windows = { skip: process.platform !== "win32" };
test("a fresh install selects only the store origin and logs success", windows, () => {
  simulateRegistration("fresh", "store", "install");
});
for (const channel of ["store", "development"]) {
  test(`an upgrade preserves the registered ${channel} origin`, windows, () => {
    simulateRegistration("upgrade", channel, "upgrade");
  });
  test(`a missing ${channel} Host at the exact versioned destination is restored`, windows, () => {
    simulateRegistration("repair", channel, "recovery");
  });
}
test("a missing development Host in the project layout migrates to the fixed location", windows, () => {
  simulateRegistration("source-repair", "development", "recovery");
});
for (const scenario of [
  "unknown-origin", "multiple-origins", "tampered-manifest", "extra-key", "duplicate-key", "scalar-origin",
  "missing-manifest", "relative-path", "foreign-path", "alternate-stream", "directory-host", "reparse-host",
  "tampered-host", "tampered-payload",
]) {
  test(`automatic registration refuses ${scenario} and logs failure`, windows, () => {
    simulateRegistration(scenario, "store", "failed");
  });
}
