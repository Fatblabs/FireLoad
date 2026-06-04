import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharedSource = fs.readFileSync(path.join(root, "src/shared.js"), "utf8");
const optionsSource = fs.readFileSync(path.join(root, "options/options.js"), "utf8");

class FakeElement {
  constructor(id = "", dataset = {}) {
    this.id = id;
    this.dataset = dataset;
    this.attributes = {};
    this.checked = false;
    this.listeners = {};
    this.textContent = "";
    this.value = "";
  }

  addEventListener(type, listener) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  dispatch(type) {
    for (const listener of this.listeners[type] || []) {
      listener({ target: this });
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] || "";
  }
}

async function settle() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function createHarness(initialSettings = {}, behavior = {}) {
  const domListeners = {};
  const elements = new Map();
  const modeButtons = ["efficiency", "balanced", "blazing"].map((mode) => new FakeElement("", { mode }));
  const ids = [
    "enabled",
    "liveCacheTracking",
    "respectSaveData",
    "respectNoPrefetch",
    "blockSensitiveUrls",
    "blockedHosts",
    "saveButton",
    "saveState"
  ];

  for (const id of ids) elements.set(`#${id}`, new FakeElement(id));

  const metrics = {
    savedPatches: []
  };

  const context = vm.createContext({
    browser: null,
    console,
    document: {
      querySelector(selector) {
        if (elements.has(selector)) return elements.get(selector);
        if (selector === ".mode-row button[aria-pressed='true']") {
          return modeButtons.find((button) => button.getAttribute("aria-pressed") === "true") || null;
        }
        return null;
      },
      querySelectorAll(selector) {
        return selector === ".mode-row button" ? modeButtons : [];
      },
      addEventListener(type, listener) {
        domListeners[type] = listener;
      }
    },
    globalThis: null,
    Promise,
    window: {
      setTimeout(callback, ms) {
        if (ms >= 1000) return 1;
        callback();
        return 1;
      }
    }
  });
  context.globalThis = context;

  vm.runInContext(sharedSource, context, { filename: "src/shared.js" });
  let settings = context.FireLoadShared.normalizeSettings(initialSettings);

  context.browser = {
    runtime: {
      sendMessage(message) {
        if (message.type === context.FireLoadShared.MESSAGE.GET_SETTINGS) return Promise.resolve(settings);
        if (message.type === context.FireLoadShared.MESSAGE.SAVE_SETTINGS) {
          metrics.savedPatches.push(message.patch);
          if (behavior.invalidSaveResponse) return Promise.resolve(undefined);
          settings = context.FireLoadShared.mergeSettings(settings, message.patch || {});
          return Promise.resolve(settings);
        }
        return Promise.resolve(undefined);
      }
    }
  };

  vm.runInContext(optionsSource, context, { filename: "options/options.js" });

  return {
    elements,
    metrics,
    modeButtons,
    start() {
      domListeners.DOMContentLoaded();
    }
  };
}

{
  const harness = createHarness({
    enabled: false,
    mode: "blazing",
    liveCacheTracking: true,
    blockedHosts: ["example.com", "*.internal.test"]
  });
  harness.start();
  await settle();

  assert.equal(harness.elements.get("#enabled").checked, false);
  assert.equal(harness.elements.get("#liveCacheTracking").checked, true);
  assert.equal(harness.elements.get("#blockedHosts").value, "example.com\n*.internal.test");
  assert.equal(harness.modeButtons.find((button) => button.dataset.mode === "blazing").getAttribute("aria-pressed"), "true");
}

{
  const harness = createHarness({ enabled: true, mode: "balanced" });
  harness.start();
  await settle();

  const efficiency = harness.modeButtons.find((button) => button.dataset.mode === "efficiency");
  efficiency.dispatch("click");
  await settle();

  assert.equal(harness.metrics.savedPatches.at(-1).mode, "efficiency");
  assert.equal(efficiency.getAttribute("aria-pressed"), "true");
  assert.equal(harness.elements.get("#saveState").textContent, "Saved");
}

{
  const harness = createHarness({ enabled: true, mode: "balanced" });
  harness.start();
  await settle();

  harness.elements.get("#blockedHosts").value = " example.com \n\n*.internal.test ";
  harness.elements.get("#saveButton").dispatch("click");
  await settle();

  assert.equal(harness.metrics.savedPatches.at(-1).blockedHosts.length, 2);
  assert.equal(harness.metrics.savedPatches.at(-1).blockedHosts[0], "example.com");
  assert.equal(harness.metrics.savedPatches.at(-1).blockedHosts[1], "*.internal.test");
  assert.equal(harness.elements.get("#saveState").textContent, "Saved");
}

{
  const harness = createHarness({ enabled: true }, { invalidSaveResponse: true });
  harness.start();
  await settle();

  const enabled = harness.elements.get("#enabled");
  enabled.checked = false;
  enabled.dispatch("change");
  await settle();

  assert.equal(harness.metrics.savedPatches.at(-1).enabled, false);
  assert.equal(enabled.checked, true);
  assert.equal(harness.elements.get("#saveState").textContent, "Not saved");
}

console.log("Options UI tests passed.");
