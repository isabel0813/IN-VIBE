// Use a normal Rust installation, or the checkout-local QA toolchain if present.
// This helper never downloads tools or changes the system environment.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { delimiter, join } from "node:path";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const env = { ...process.env };
const localCargo = join(root, ".tools", "cargo");
const cargoExe = process.platform === "win32" ? "cargo.exe" : "cargo";
const localBin = join(localCargo, "bin", cargoExe);
if (existsSync(localBin)) {
  env.CARGO_HOME = localCargo;
  env.RUSTUP_HOME = join(root, ".tools", "rustup");
  const pathKey =
    Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
  env[pathKey] = join(localCargo, "bin") + delimiter + (env[pathKey] || "");
}
const [action, ...args] = process.argv.slice(2);
const hostAction = action?.startsWith("host:");
const cargoAction = hostAction || action === "check" || action === "test" || action === "fmt";
const executable = cargoAction
  ? existsSync(localBin)
    ? localBin
    : cargoExe
  : process.execPath;
const parameters = cargoAction
  ? hostAction ? [action.slice(5), "--manifest-path", "../extension/native-host/Cargo.toml", "--target-dir", "src-tauri/target", ...args] : [action, "--manifest-path", "src-tauri/Cargo.toml", ...args]
  : [
      require.resolve("@tauri-apps/cli/tauri.js"),
      ...(action ? [action] : []),
      ...args,
    ];
const child = spawn(executable, parameters, {
  cwd: root,
  env,
  stdio: "inherit",
});
child.on("error", (error) => {
  console.error(
    `데스크톱 도구를 실행하지 못했습니다: ${error.message}\nRust/MSVC/WebView2 설치 방법은 docs/desktop.md를 확인하세요.`,
  );
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
