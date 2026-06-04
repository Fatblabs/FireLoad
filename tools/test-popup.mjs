import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharedSource = fs.readFileSync(path.join(root, "src/shared.js"), "utf8");
const popupSource = fs.readFileSync(path.join(root, "popup/popup.js"), "utf8");

class FakeElement {
  constructor(id = "", dataset = {}) {
    this.id = id;
    this.dataset = dataset;
    this.attributes = {};
    this.checked = false;
    this.disabled = false;
    this.listeners = {};
    this.textContent = "";
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
    "enabledToggle",
    "liveStatsToggle",
    "statusText",
    "pageStatus",
    "prefetchedCount",
    "originCount",
    "queueCount",
    "dnsCount",
    "connectCount",
    "skippedCount",
    "lastReason",
    "refreshButton",
    "optionsButton",
    "saveState"
  ];

  for (const id of ids) elements.set(`#${id}`, new FakeElement(id));

  const metrics = {
    intervals: [],
    clearedIntervals: [],
    tabQueries: 0,
    tabMessages: 0,
    savedPatches: []
  };

  const context = vm.createContext({
    browser: null,
    clearInterval: () => {},
    console,
    document: {
      querySelector(selector) {
        return elements.get(selector) || null;
      },
      querySelectorAll(selector) {
        return selector === ".mode-button" ? modeButtons : [];
      },
      addEventListener(type, listener) {
        domListeners[type] = listener;
      }
    },
    globalThis: null,
    Promise,
    setInterval: () => 0,
    setTimeout: () => 0,
    window: {
      addEventListener() {},
      clearInterval(id) {
        metrics.clearedIntervals.push(id);
      },
      setInterval(callback, ms) {
        const id = metrics.intervals.length + 1;
        metrics.intervals.push({ id, callback, ms });
        return id;
      },
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
      openOptionsPage() {},
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
    },
    tabs: {
      query() {
        metrics.tabQueries += 1;
        return Promise.resolve([{ id: 9 }]);
      },
      sendMessage(_tabId, message) {
        metrics.tabMessages += 1;
        assert.equal(message.type, context.FireLoadShared.MESSAGE.GET_PAGE_SUMMARY);
        return Promise.resolve({
          tracking: true,
          status: "active",
          prefetched: 2,
          warmedOrigins: 1,
          queued: 0,
          inFlight: 0,
          dnsPrefetches: 1,
          preconnects: 1,
          skipped: 0,
          lastReason: "hover"
        });
      }
    }
  };

  vm.runInContext(popupSource, context, { filename: "popup/popup.js" });

  return {
    context,
    elements,
    metrics,
    start() {
      domListeners.DOMContentLoaded();
    }
  };
}

{
  const harness = createHarness();
  harness.start();
  await settle();

  assert.equal(harness.elements.get("#liveStatsToggle").checked, false);
  assert.equal(harness.elements.get("#refreshButton").disabled, true);
  assert.equal(harness.elements.get("#pageStatus").textContent, "Live off");
  assert.equal(harness.metrics.intervals.length, 0);
  assert.equal(harness.metrics.tabQueries, 0);
  assert.equal(harness.metrics.tabMessages, 0);
}

{
  const harness = createHarness({ liveCacheTracking: true });
  harness.start();
  await settle();

  assert.equal(harness.elements.get("#liveStatsToggle").checked, true);
  assert.equal(harness.elements.get("#refreshButton").disabled, false);
  assert.equal(harness.metrics.intervals.length, 1);
  assert.equal(harness.metrics.intervals[0].ms, 350);
  assert.equal(harness.metrics.tabQueries, 1);
  assert.equal(harness.metrics.tabMessages, 1);
}

{
  const harness = createHarness({ liveCacheTracking: true });
  harness.start();
  await settle();

  const toggle = harness.elements.get("#liveStatsToggle");
  toggle.checked = false;
  toggle.dispatch("change");
  await settle();

  assert.equal(harness.metrics.savedPatches.at(-1).liveCacheTracking, false);
  assert.equal(harness.metrics.clearedIntervals.length, 1);
  assert.equal(harness.elements.get("#refreshButton").disabled, true);
  assert.equal(harness.elements.get("#pageStatus").textContent, "Live off");
}

{
  const harness = createHarness({ enabled: true }, { invalidSaveResponse: true });
  harness.start();
  await settle();

  const enabled = harness.elements.get("#enabledToggle");
  enabled.checked = false;
  enabled.dispatch("change");
  await settle();

  assert.equal(harness.metrics.savedPatches.at(-1).enabled, false);
  assert.equal(enabled.checked, true);
  assert.equal(harness.elements.get("#saveState").textContent, "Not saved");
}

console.log("Popup live tracking tests passed.");
