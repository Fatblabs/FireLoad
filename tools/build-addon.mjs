import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const source = args.includes("--source");
const outputIndex = args.indexOf("--output-dir");
const dist = outputIndex < 0 ? path.join(root, "dist") : path.resolve(args[outputIndex + 1]);
const filename = source ? "fireload-source.zip" : "fireload.xpi";
const destination = path.join(dist, filename);
const entries = ["manifest.json", "src", "popup", "options", "onboarding", "icons", "README.md"];
if (source) entries.push("amo", "package.json", "tools", ".github");
const staging = fs.mkdtempSync(path.join(os.tmpdir(), "fireload-build-"));
const archive = path.join(staging, filename);
const timestamp = new Date("2000-01-01T00:00:00Z");

try {
  const files = [];
  function stage(relative) {
    const original = path.join(root, relative);
    const stat = fs.lstatSync(original);
    if (stat.isSymbolicLink()) throw new Error(`Cannot package symlink: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(original).sort()) {
        if (name !== ".DS_Store") stage(path.join(relative, name));
      }
      return;
    }
    const target = path.join(staging, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(original, target);
    fs.chmodSync(target, 0o644);
    fs.utimesSync(target, timestamp, timestamp);
    files.push(relative.split(path.sep).join("/"));
  }
  for (const entry of entries) stage(entry);

  // Normalize ordering, times, permissions, and ZIP metadata for reproducible AMO builds.
  const result = spawnSync("zip", ["-X", "-q", archive, "-@"], {
    cwd: staging,
    env: { ...process.env, TZ: "UTC" },
    input: files.sort().join("\n") + "\n",
    encoding: "utf8"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "zip failed");
  fs.mkdirSync(dist, { recursive: true });
  fs.copyFileSync(archive, destination);
  console.log(`Built ${destination}`);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
