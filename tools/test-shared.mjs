import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "src/shared.js"), "utf8");
const context = vm.createContext({
  console,
  navigator: {},
  URL
});

vm.runInContext(source, context, { filename: "src/shared.js" });

const shared = context.FireLoadShared;
const base = "https://shop.example/products/widgets/?page=1";

function anchor(href, attrs = {}) {
  return {
    href,
    target: attrs.target || "",
    textContent: attrs.text || "",
    nodeType: 1,
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name);
    },
    getAttribute(name) {
      return attrs[name] || "";
    },
    getBoundingClientRect() {
      return attrs.rect || { top: 50, left: 20, right: 120, bottom: 80, width: 100, height: 30 };
    }
  };
}

assert.equal(shared.normalizeSettings({ mode: "unknown" }).mode, "balanced");
assert.equal(shared.normalizeSettings({ enabled: false }).enabled, false);
assert.equal(shared.normalizeSettings({}).liveCacheTracking, false);
assert.equal(shared.normalizeSettings({ liveCacheTracking: true }).liveCacheTracking, true);
assert.equal(shared.normalizeSettings({}).allowCrossSiteDocumentPrefetch, false);
assert.equal(shared.normalizeSettings({ allowCrossSiteDocumentPrefetch: true }).allowCrossSiteDocumentPrefetch, true);
assert.equal(shared.normalizeSettings({ blockedHosts: [" HTTPS://Example.COM/path "] }).blockedHosts[0], "example.com");

const normal = shared.classifyUrl("/products/screws/", base, {});
assert.equal(normal.ok, true);
assert.equal(normal.sameOrigin, true);
assert.equal(normal.key, "https://shop.example/products/screws/");

const maliciousSettings = JSON.parse('{"__proto__":{"polluted":true},"mode":"blazing","blockedHosts":[" HTTPS://Example.COM/path "]}');
const normalizedMalicious = shared.normalizeSettings(maliciousSettings);
assert.equal(normalizedMalicious.mode, "blazing");
assert.equal(normalizedMalicious.blockedHosts[0], "example.com");
assert.equal({}.polluted, undefined);

const merged = shared.mergeSettings(
  { enabled: true, mode: "balanced", blockedHosts: ["safe.test"] },
  JSON.parse('{"__proto__":{"polluted":true},"mode":"blazing","enabled":false,"allowCrossSiteDocumentPrefetch":true,"blockedHosts":["*.internal.test"]}')
);
assert.equal(merged.enabled, false);
assert.equal(merged.mode, "blazing");
assert.equal(merged.allowCrossSiteDocumentPrefetch, true);
assert.equal(merged.blockedHosts.length, 1);
assert.equal(merged.blockedHosts[0], "*.internal.test");
assert.equal({}.polluted, undefined);

assert.equal(shared.classifyUrl("/files/manual.pdf", base, {}).reason, "static");
assert.equal(shared.classifyUrl("javascript:alert(1)", base, {}).reason, "invalid");
assert.equal(shared.classifyUrl("/checkout/cart", base, {}).reason, "sensitive");
assert.equal(shared.classifyUrl("http://shop.example/insecure", base, {}).reason, "downgrade");
assert.equal(shared.classifyPage("https://shop.example/checkout/payment", {}).reason, "sensitive page");
assert.equal(shared.classifyPage("https://internal.example/", { blockedHosts: ["internal.example"] }).reason, "blocked host");
assert.equal(shared.classifyUrl("https://cdn.example/page", base, { blockedHosts: ["*.example"] }).reason, "blocked-host");
assert.equal(shared.classifyAnchor(anchor("/download", { download: "" }), base, {}).reason, "download");
assert.equal(shared.classifyAnchor(anchor("/sponsored", { rel: "nofollow" }), base, {}).reason, "rel");

const nextScore = shared.scoreAnchor(anchor("/products/widgets/2", { rel: "next", text: "Next" }), new URL("/products/widgets/2", base), base);
assert.ok(nextScore >= 90, `expected a high next-link score, got ${nextScore}`);

const firstConfig = shared.modeConfig("balanced");
firstConfig.maxQueue = 999;
assert.notEqual(shared.modeConfig("balanced").maxQueue, 999);

for (const reason of ["contextmenu", "auxclick", "pointerdown", "keyboard"]) {
  assert.equal(shared.INTENT_REASONS[reason], true, `${reason} should count as navigation intent`);
}

console.log("Shared policy tests passed.");
