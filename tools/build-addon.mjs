import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const xpi = path.join(dist, "fireload.xpi");

fs.mkdirSync(dist, { recursive: true });
fs.rmSync(xpi, { force: true });

const args = [
  "-X",
  "-r",
  xpi,
  "manifest.json",
  "src",
  "popup",
  "options",
  "icons",
  "README.md",
  "-x",
  "*.DS_Store"
];

const result = spawnSync("zip", args, {
  cwd: root,
  stdio: "inherit"
});

if (result.error) {
  if (result.error.code === "ENOENT") {
    console.error("Error: zip is required to build dist/fireload.xpi.");
  } else {
    console.error(result.error);
  }
  process.exit(1);
}

process.exit(result.status ?? 1);
