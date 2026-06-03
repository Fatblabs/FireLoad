import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const required = new Set(["manifest.json"]);

function addFile(file) {
  if (file) required.add(file);
}

function addHtmlReferences(file) {
  const html = fs.readFileSync(path.join(root, file), "utf8");
  const baseDir = path.dirname(file);
  const referencePattern = /\b(?:href|src)=["']([^"']+)["']/g;
  for (const match of html.matchAll(referencePattern)) {
    const reference = match[1];
    if (/^(?:[a-z]+:|#|\/)/i.test(reference)) continue;
    required.add(path.normalize(path.join(baseDir, reference)));
  }
}

Object.values(manifest.icons || {}).forEach(addFile);
Object.values(manifest.action?.default_icon || {}).forEach(addFile);
addFile(manifest.action?.default_popup);
addFile(manifest.options_ui?.page);
(manifest.background?.scripts || []).forEach(addFile);
(manifest.content_scripts || []).forEach((entry) => (entry.js || []).forEach(addFile));

for (const htmlFile of [manifest.action?.default_popup, manifest.options_ui?.page].filter(Boolean)) {
  addHtmlReferences(htmlFile);
}

for (const file of required) {
  const fullPath = path.join(root, file);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing manifest file: ${file}`);
  }
}

const scripts = [
  "src/shared.js",
  "src/background.js",
  "src/content.js",
  "popup/popup.js",
  "options/options.js"
];

for (const script of scripts) {
  const source = fs.readFileSync(path.join(root, script), "utf8");
  new vm.Script(source, { filename: script });
}

if (manifest.manifest_version !== 3) {
  throw new Error("FireLoad currently targets Firefox Manifest V3.");
}

if (manifest.browser_action) {
  throw new Error("Manifest V3 must use action, not browser_action.");
}

if (!manifest.host_permissions?.includes("<all_urls>")) {
  throw new Error("Expected <all_urls> in host_permissions for universal page support.");
}

for (const mode of ["efficiency", "balanced", "blazing"]) {
  if (!fs.readFileSync(path.join(root, "src/shared.js"), "utf8").includes(`${mode}:`)) {
    throw new Error(`Missing mode config: ${mode}`);
  }
}

console.log("Extension structure and JavaScript syntax look good.");
