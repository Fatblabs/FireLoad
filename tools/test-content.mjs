import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharedSource = fs.readFileSync(path.join(root, "src/shared.js"), "utf8");
const contentSource = fs.readFileSync(path.join(root, "src/content.js"), "utf8");

class FakeElement {
  constructor(tagName, attrs = {}) {
    this.tagName = tagName.toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.listeners = {};
    this.style = {};
    this.textContent = attrs.text || "";
    this.href = attrs.href || "";
    this.target = attrs.target || "";
    this.attributes = { ...attrs };
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    this.children = this.children.filter((item) => item !== child);
    child.parentNode = null;
    return child;
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }

  getAttribute(name) {
    if (name === "href") return this.href;
    if (name === "rel") return this.attributes.rel || "";
    if (name === "aria-label") return this.attributes["aria-label"] || "";
    return this.attributes[name] || "";
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    this[name] = String(value);
  }

  closest(selector) {
    return selector === "a[href]" && this.href ? this : null;
  }

  contains(node) {
    return node === this || this.children.includes(node);
  }

  getBoundingClientRect() {
    return this.attributes.rect || { top: 40, left: 20, right: 180, bottom: 70, width: 160, height: 30 };
  }
}

function createHarness(storedSettings = {}) {
  const listeners = new Map();
  const head = new FakeElement("head");
  const documentElement = new FakeElement("html");
  const anchors = [];
  const runtimeListeners = [];
  const storageListeners = [];

  const document = {
    head,
    documentElement,
    readyState: "complete",
    visibilityState: "visible",
    links: anchors,
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    getElementsByTagName(tagName) {
      if (tagName === "head") return [head];
      return [];
    },
    querySelectorAll() {
      return [];
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatch(type, event) {
      for (const listener of listeners.get(type) || []) {
        listener(event);
      }
    }
  };

  const browser = {
    storage: {
      local: {
        get() {
          return Promise.resolve({ fireloadSettings: storedSettings });
        }
      },
      onChanged: {
        addListener(listener) {
          storageListeners.push(listener);
        }
      }
    },
    runtime: {
      id: "fireload@test",
      getURL(file = "") {
        return `moz-extension://fireload-test/${file}`;
      },
      onMessage: {
        addListener(listener) {
          runtimeListeners.push(listener);
        }
      }
    }
  };

  const window = {
    PointerEvent: function PointerEvent() {},
    innerHeight: 800,
    innerWidth: 1200,
    setTimeout(callback) {
      return globalThis.setTimeout(callback, 0);
    },
    clearTimeout(id) {
      globalThis.clearTimeout(id);
    },
    addEventListener() {}
  };

  const context = vm.createContext({
    browser,
    console,
    Date,
    document,
    globalThis: null,
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    location: new URL("https://site.test/start"),
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    navigator: {},
    Promise,
    Set,
    URL,
    WeakMap,
    window
  });
  context.globalThis = context;

  vm.runInContext(sharedSource, context, { filename: "src/shared.js" });
  vm.runInContext(contentSource, context, { filename: "src/content.js" });

  return {
    anchors,
    context,
    document,
    head,
    listeners,
    runtimeListeners,
    async ready() {
      await Promise.resolve();
      await Promise.resolve();
    },
    async summary() {
      assert.equal(runtimeListeners.length, 1);
      return runtimeListeners[0](
        { type: context.FireLoadShared.MESSAGE.GET_PAGE_SUMMARY },
        { id: "fireload@test", url: "moz-extension://fireload-test/popup/popup.html" }
      );
    }
  };
}

function link(href) {
  return new FakeElement("a", { href, text: "Open target" });
}

async function assertPrefetchesOn(eventName, event) {
  const harness = createHarness({ enabled: true, mode: "balanced" });
  const anchor = link("https://site.test/next");
  harness.anchors.push(anchor);
  await harness.ready();

  harness.document.dispatch(eventName, { target: anchor, button: event.button || 0, key: event.key || "", ctrlKey: !!event.ctrlKey, metaKey: !!event.metaKey, shiftKey: !!event.shiftKey });

  const prefetches = harness.head.children.filter((child) => child.rel === "prefetch" && child.as === "document");
  assert.equal(prefetches.length, 1, `${eventName} should add one document prefetch`);
  assert.equal(prefetches[0].href, "https://site.test/next");
  assert.equal(prefetches[0].dataset.fireload, eventName === "keydown" ? "keyboard" : eventName);
}

await assertPrefetchesOn("contextmenu", {});
await assertPrefetchesOn("auxclick", { button: 1 });
await assertPrefetchesOn("pointerdown", { button: 0, metaKey: true });
await assertPrefetchesOn("keydown", { key: "Enter", metaKey: true });

{
  const harness = createHarness({ enabled: true, mode: "balanced" });
  const anchor = link("https://other.test/hovered");
  harness.anchors.push(anchor);
  await harness.ready();
  harness.document.dispatch("mouseover", { target: anchor });
  harness.document.dispatch("mouseout", { target: anchor, relatedTarget: null });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const prefetches = harness.head.children.filter((child) => child.rel === "prefetch" && child.as === "document");
  assert.equal(prefetches.length, 0);
}

{
  const harness = createHarness({ enabled: true, mode: "balanced", allowCrossSiteDocumentPrefetch: true });
  const anchor = link("https://other.test/hovered");
  harness.anchors.push(anchor);
  await harness.ready();
  harness.document.dispatch("mouseover", { target: anchor });
  harness.document.dispatch("mouseout", { target: anchor, relatedTarget: null });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const prefetches = harness.head.children.filter((child) => child.rel === "prefetch" && child.as === "document");
  assert.equal(prefetches.length, 1);
  assert.equal(prefetches[0].href, "https://other.test/hovered");
  assert.equal(prefetches[0].dataset.fireload, "hover");
}

{
  const harness = createHarness({ enabled: true, mode: "efficiency" });
  const anchor = link("https://other.test/next");
  harness.anchors.push(anchor);
  await harness.ready();
  harness.document.dispatch("contextmenu", { target: anchor, button: 2 });
  const prefetches = harness.head.children.filter((child) => child.rel === "prefetch" && child.as === "document");
  assert.equal(prefetches.length, 0);
}

{
  const harness = createHarness({ enabled: true, mode: "efficiency", allowCrossSiteDocumentPrefetch: true });
  const anchor = link("https://other.test/next");
  harness.anchors.push(anchor);
  await harness.ready();
  harness.document.dispatch("contextmenu", { target: anchor, button: 2 });
  const prefetches = harness.head.children.filter((child) => child.rel === "prefetch" && child.as === "document");
  assert.equal(prefetches.length, 1);
  assert.equal(prefetches[0].href, "https://other.test/next");
}

{
  const harness = createHarness({ enabled: false, mode: "blazing" });
  const anchor = link("https://site.test/next");
  harness.anchors.push(anchor);
  await harness.ready();
  harness.document.dispatch("contextmenu", { target: anchor, button: 2 });
  assert.equal(harness.head.children.filter((child) => child.rel === "prefetch").length, 0);
}

{
  const harness = createHarness({ enabled: true, mode: "blazing" });
  const anchor = link("https://site.test/logout");
  harness.anchors.push(anchor);
  await harness.ready();
  harness.document.dispatch("contextmenu", { target: anchor, button: 2 });
  assert.equal(harness.head.children.filter((child) => child.rel === "prefetch").length, 0);
  const summary = await harness.summary();
  assert.equal(summary.tracking, false);
  assert.equal(summary.skipped, 0);
}

{
  const harness = createHarness({ enabled: true, mode: "blazing", liveCacheTracking: true });
  const anchor = link("https://site.test/logout");
  harness.anchors.push(anchor);
  await harness.ready();
  harness.document.dispatch("contextmenu", { target: anchor, button: 2 });
  assert.equal(harness.head.children.filter((child) => child.rel === "prefetch").length, 0);
  const summary = await harness.summary();
  assert.equal(summary.tracking, true);
  assert.equal(summary.skipped, 1);
}

{
  const harness = createHarness({ enabled: true, mode: "blazing" });
  const anchor = link("https://site.test/next");
  harness.anchors.push(anchor);
  harness.context.location = new URL("https://site.test/checkout/payment");
  await harness.ready();
  harness.document.dispatch("contextmenu", { target: anchor, button: 2 });
  assert.equal(harness.head.children.filter((child) => child.rel === "prefetch").length, 0);
  const summary = await harness.summary();
  assert.equal(summary.status, "sensitive page");
}

{
  const harness = createHarness({ enabled: true, mode: "balanced" });
  await harness.ready();
  assert.equal(
    harness.runtimeListeners[0](
      { type: harness.context.FireLoadShared.MESSAGE.GET_PAGE_SUMMARY },
      { id: "fireload@test", url: "https://site.test/page" }
    ),
    undefined
  );
}

console.log("Content intent tests passed.");
