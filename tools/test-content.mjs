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

  removeEventListener(type, listener) {
    if (this.listeners[type] === listener) delete this.listeners[type];
  }

  dispatch(type) {
    if (this.listeners[type]) this.listeners[type]({ type });
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

function createHarness(storedSettings = {}, behavior = {}) {
  const listeners = new Map();
  const head = new FakeElement("head");
  const documentElement = new FakeElement("html");
  const anchors = [];
  const runtimeListeners = [];
  const storageListeners = [];
  const windowListeners = new Map();
  const intersections = [];
  const mutations = [];
  const metas = [];
  const timers = new Map();
  let now = 0;
  let timerId = 0;

  class FakeIntersectionObserver {
    constructor(callback) { this.callback = callback; this.observed = new Set(); intersections.push(this); }
    observe(node) { this.observed.add(node); }
    unobserve(node) { this.observed.delete(node); }
    disconnect() { this.observed.clear(); }
  }

  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; this.active = false; mutations.push(this); }
    observe() { this.active = true; }
    disconnect() { this.active = false; }
  }

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
    querySelectorAll(selector) {
      return selector === "meta[http-equiv]" ? metas : [];
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
          if (behavior.get) return behavior.get();
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
    IntersectionObserver: FakeIntersectionObserver,
    MutationObserver: FakeMutationObserver,
    PointerEvent: function PointerEvent() {},
    innerHeight: 800,
    innerWidth: 1200,
    setTimeout(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    addEventListener(type, listener) { windowListeners.set(type, listener); }
  };

  const context = vm.createContext({
    browser,
    console,
    Date,
    document,
    globalThis: null,
    IntersectionObserver: FakeIntersectionObserver,
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    location: new URL("https://site.test/start"),
    MutationObserver: FakeMutationObserver,
    navigator: behavior.navigator || {},
    Promise,
    Set,
    Map,
    URL,
    WeakMap,
    window
  });
  if (behavior.nativeIdle) {
    window.requestIdleCallback = (callback) => window.setTimeout(callback, 50);
    window.cancelIdleCallback = window.clearTimeout;
  }
  context.globalThis = context;

  vm.runInContext(sharedSource, context, { filename: "src/shared.js" });
  vm.runInContext(contentSource, context, { filename: "src/content.js" });

  return {
    anchors,
    context,
    document,
    head,
    listeners,
    intersections,
    mutations,
    metas,
    timers,
    windowListeners,
    runtimeListeners,
    changeSettings(next) {
      for (const listener of storageListeners) listener({ fireloadSettings: { newValue: next } }, "local");
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = end;
    },
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
  harness.advance(100);
  const prefetches = harness.head.children.filter((child) => child.rel === "prefetch" && child.as === "document");
  assert.equal(prefetches.length, 0);
}

{
  const harness = createHarness({ enabled: true, mode: "balanced", allowCrossSiteDocumentPrefetch: true });
  const anchor = link("https://other.test/hovered");
  harness.anchors.push(anchor);
  await harness.ready();
  harness.document.dispatch("mouseover", { target: anchor });
  harness.advance(70);
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

function prefetches(harness) {
  return harness.head.children.filter((child) => child.rel === "prefetch");
}

function intent(harness, anchor) {
  harness.document.dispatch("contextmenu", { target: anchor, button: 2 });
}

for (const [mode, budget, concurrency] of [["efficiency", 4, 1], ["balanced", 12, 2], ["blazing", 36, 6]]) {
  const harness = createHarness({ mode, liveCacheTracking: true });
  await harness.ready();
  for (let i = 0; i < 100; i++) intent(harness, link(`https://site.test/page-${i}`));
  assert.equal(prefetches(harness).length, concurrency, `${mode} concurrency`);
  assert.equal((await harness.summary()).queued, budget - concurrency, `${mode} queued budget`);
  for (let i = 0; i < budget; i++) {
    for (const hint of [...prefetches(harness)]) hint.dispatch("load");
  }
  assert.equal(prefetches(harness).length, budget, `${mode} total budget`);
  assert.equal((await harness.summary()).inFlight, 0);
  assert.equal((await harness.summary()).queued, 0);
  assert.equal((await harness.summary()).prefetched, budget);
}

{
  let resolveSettings;
  const harness = createHarness({}, { get: () => new Promise((resolve) => { resolveSettings = resolve; }) });
  intent(harness, link("https://site.test/early"));
  assert.equal(prefetches(harness).length, 0, "no work before settings load");
  harness.changeSettings({ enabled: false });
  resolveSettings({ fireloadSettings: { enabled: true } });
  await harness.ready();
  intent(harness, link("https://site.test/late"));
  assert.equal(prefetches(harness).length, 0, "stale startup read cannot overwrite newer settings");
}

{
  const harness = createHarness({}, { get: () => Promise.reject(new Error("Storage unavailable")) });
  await harness.ready();
  intent(harness, link("https://site.test/early"));
  assert.equal(prefetches(harness).length, 0, "storage failure must not enable speculative requests");
}

for (const event of ["mouseover", "focusin"]) {
  const harness = createHarness({ mode: "efficiency" });
  await harness.ready();
  const anchor = link("https://site.test/cancelled");
  harness.document.dispatch(event, { target: anchor });
  harness.document.dispatch(event === "mouseover" ? "mouseout" : "focusout", { target: anchor });
  harness.advance(1000);
  assert.equal(prefetches(harness).length, 0, `${event} leaving cancels intent`);
}

for (const patch of [{ enabled: false }, { blockedHosts: ["site.test"] }, { mode: "efficiency" }]) {
  const harness = createHarness({ mode: "balanced", liveCacheTracking: true });
  await harness.ready();
  for (let i = 0; i < 8; i++) intent(harness, link(`https://site.test/queued-${i}`));
  const old = [...prefetches(harness)];
  assert.ok((await harness.summary()).queued > 0);
  harness.changeSettings({ mode: "balanced", liveCacheTracking: true, ...patch });
  assert.equal((await harness.summary()).queued, 0, "settings discard stale queue");
  assert.equal((await harness.summary()).inFlight, 0, "settings release old work");
  assert.equal(prefetches(harness).length, 0, "settings remove stale hints");
  for (const hint of old) hint.dispatch("load");
  harness.advance(10000);
  assert.equal(prefetches(harness).length, 0, "late events cannot resume old work");
}

{
  const harness = createHarness({ mode: "balanced", allowCrossSiteDocumentPrefetch: true });
  await harness.ready();
  for (let i = 0; i < 6; i++) intent(harness, link(`https://other.test/page-${i}`));
  harness.changeSettings({ mode: "balanced", allowCrossSiteDocumentPrefetch: false });
  harness.advance(20000);
  assert.equal(prefetches(harness).length, 0, "revoking cross-site consent discards queued requests");
}

{
  const harness = createHarness({ mode: "balanced" });
  await harness.ready();
  const anchor = link("https://site.test/visible-again");
  harness.anchors.push(anchor);
  harness.document.visibilityState = "hidden";
  harness.document.dispatch("visibilitychange", {});
  assert.ok(harness.mutations.every((observer) => !observer.active));
  harness.advance(10000);
  assert.equal(prefetches(harness).length, 0);
  harness.document.visibilityState = "visible";
  harness.document.dispatch("visibilitychange", {});
  const observer = harness.intersections.at(-1);
  assert.ok(observer.observed.has(anchor));
  observer.callback([{ isIntersecting: true, target: anchor }]);
  assert.equal(prefetches(harness).length, 1, "visible tab resumes prediction");
}

{
  const harness = createHarness({ mode: "balanced" });
  await harness.ready();
  const observer = harness.mutations.at(-1);
  intent(harness, link("https://site.test/next"));
  const timerCount = harness.timers.size;
  observer.callback([{ type: "childList", addedNodes: prefetches(harness), removedNodes: [] }]);
  observer.callback([{ type: "childList", addedNodes: [{ nodeType: 3 }], removedNodes: [] }]);
  assert.equal(harness.timers.size, timerCount, "hints and text cannot cause repeated rescans");
  observer.callback([{ type: "attributes" }]);
  assert.equal(harness.timers.size, timerCount + 1, "changed href schedules a rescan");
}

{
  const harness = createHarness({ mode: "efficiency", liveCacheTracking: true });
  await harness.ready();
  intent(harness, link("https://site.test/first"));
  intent(harness, link("https://site.test/second"));
  const first = prefetches(harness)[0];
  first.dispatch("error");
  first.dispatch("load");
  assert.equal(prefetches(harness).length, 2, "error drains queue exactly once");
  assert.equal((await harness.summary()).inFlight, 1);
  harness.advance(4500);
  assert.equal((await harness.summary()).inFlight, 0, "timeout releases queue slot");
}

{
  const harness = createHarness({ mode: "balanced" });
  await harness.ready();
  intent(harness, link("https://site.test/first#one"));
  intent(harness, link("https://site.test/first#two"));
  assert.equal(prefetches(harness).length, 1, "fragment variants deduplicate");
  harness.changeSettings({ mode: "balanced", liveCacheTracking: true });
  assert.equal(prefetches(harness).length, 1, "tracking toggle must not cancel useful work");
}

{
  const harness = createHarness({ mode: "balanced" });
  harness.document.readyState = "loading";
  const anchor = link("https://site.test/after-dom");
  harness.anchors.push(anchor);
  await harness.ready();
  assert.equal(harness.intersections.length, 0);
  harness.document.readyState = "complete";
  harness.document.dispatch("DOMContentLoaded", {});
  assert.ok(harness.intersections.at(-1).observed.has(anchor));
}

{
  const harness = createHarness({ mode: "balanced" }, { nativeIdle: true });
  harness.anchors.push(link("https://site.test/idle"));
  await harness.ready();
  harness.advance(50);
  assert.equal(prefetches(harness).length, 1, "native idle callback scans visible candidates");
  harness.windowListeners.get("pagehide")();
  assert.equal(prefetches(harness).length, 0);
  harness.windowListeners.get("pageshow")();
  assert.ok(harness.mutations.at(-1).active, "BFCache restore restarts observers");
}

{
  const harness = createHarness({ mode: "balanced" }, { nativeIdle: true });
  harness.anchors.push(link("https://site.test/stale-idle"));
  await harness.ready();
  harness.changeSettings({ mode: "efficiency" });
  harness.advance(5000);
  assert.equal(prefetches(harness).length, 0, "mode change cancels native idle work");
}

{
  let changeNetwork;
  const connection = { saveData: true, addEventListener(_type, callback) { changeNetwork = callback; } };
  const harness = createHarness({ mode: "blazing" }, { navigator: { connection } });
  await harness.ready();
  assert.equal((await harness.summary()).activeMode, "Efficiency");
  assert.equal(harness.intersections.length, 0);
  connection.saveData = false;
  changeNetwork();
  assert.equal((await harness.summary()).activeMode, "Blazing Fast");
  assert.ok(harness.intersections.length > 0);
}

{
  const harness = createHarness({ mode: "balanced" });
  harness.metas.push(new FakeElement("meta", { "http-equiv": "x-dns-prefetch-control", content: "off" }));
  await harness.ready();
  intent(harness, link("https://site.test/opted-out"));
  harness.advance(10000);
  assert.equal(prefetches(harness).length, 0);
  assert.equal((await harness.summary()).status, "page opt-out");
}

for (const promoteExisting of [false, true]) {
  const harness = createHarness({ mode: "balanced" });
  for (let i = 0; i < 12; i++) harness.anchors.push(link(`https://site.test/predicted-${i}`));
  await harness.ready();
  const observer = harness.intersections.at(-1);
  observer.callback(harness.anchors.map((anchor) => ({ isIntersecting: true, target: anchor })));
  assert.equal((await harness.summary()).queued, 10);
  const target = promoteExisting ? harness.anchors[10] : link("https://site.test/actual-intent");
  intent(harness, target);
  assert.equal((await harness.summary()).queued, 10, "intent must not expand a full budget");
  prefetches(harness)[0].dispatch("load");
  assert.equal(prefetches(harness)[2].href, target.href, "intent takes priority over viewport prediction");
  assert.equal(prefetches(harness)[2].dataset.fireload, "contextmenu");
}

console.log("Content intent, budgets, lifecycle, and privacy regression tests passed.");
