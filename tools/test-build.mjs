import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "fireload-package-test-"));
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

try {
  const first = path.join(temporary, "first");
  const second = path.join(temporary, "second");
  const extracted = path.join(temporary, "source");
  run(process.execPath, ["tools/build-addon.mjs", "--output-dir", first]);
  run(process.execPath, ["tools/build-addon.mjs", "--output-dir", second]);
  const original = fs.readFileSync(path.join(first, "fireload.xpi"));
  assert.deepEqual(original, fs.readFileSync(path.join(second, "fireload.xpi")), "repeat builds must match byte for byte");
  const files = run("unzip", ["-Z1", path.join(first, "fireload.xpi")]).trim().split("\n");
  assert.ok(files.includes("onboarding/onboarding.html"));
  assert.ok(files.includes("icons/fireload.svg"));
  assert.ok(!files.some((file) => /(?:\.DS_Store|node_modules|^tools\/|^\.github\/|^dist\/)/.test(file)));
  assert.equal(JSON.parse(run("unzip", ["-p", path.join(first, "fireload.xpi"), "manifest.json"])).browser_specific_settings.gecko.id, "fireload@local.dev");
  run(process.execPath, ["tools/build-addon.mjs", "--source", "--output-dir", first]);
  run("unzip", ["-q", path.join(first, "fireload-source.zip"), "-d", extracted]);
  run(process.execPath, ["tools/check-extension.mjs"], extracted);
  run(process.execPath, ["tools/build-addon.mjs"], extracted);
  assert.deepEqual(original, fs.readFileSync(path.join(extracted, "dist/fireload.xpi")), "source submission must reproduce the exact XPI");
  console.log("Package contents and byte-for-byte source rebuild tests passed.");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
