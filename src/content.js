(function () {
  "use strict";

  var api = typeof browser !== "undefined" ? browser : null;
  var shared = this.FireLoadShared;
  if (!api || !shared || !document || !location) return;

  var settings = shared.normalizeSettings();
  var config = shared.modeConfig(settings.mode);
  var startedAt = Date.now();
  var observer = null;
  var mutationObserver = null;
  var mutationTimer = 0;
  var hoverTimers = new Map();
  var settingsLoaded = false;
  var settingsRevision = 0;
  var workRevision = 0;
  var idleTimer = 0;
  var idleIsNative = false;
  var pageHidden = false;
  var extensionBase = api.runtime.getURL("");
  var state = {
    queue: [],
    queued: new Set(),
    inFlight: 0,
    prefetched: new Set(),
    warmedOrigins: new Set(),
    hintKeys: new Set(),
    hintElements: [],
    requests: new Set(),
    stats: {
      documentPrefetches: 0,
      dnsPrefetches: 0,
      preconnects: 0,
      skipped: 0,
      lastReason: "startup"
    }
  };

  function loadSettings() {
    var revision = settingsRevision;
    return api.storage.local.get(shared.STORAGE_KEY).then(function (result) {
      if (revision === settingsRevision) applySettings(result[shared.STORAGE_KEY]);
    }).catch(function () {});
  }

  function applySettings(raw) {
    var previous = JSON.stringify([settings.enabled, settings.mode, settings.allowCrossSiteDocumentPrefetch,
      settings.respectSaveData, settings.respectNoPrefetch, settings.blockSensitiveUrls, settings.blockedHosts]);
    settings = shared.normalizeSettings(raw);
    var next = JSON.stringify([settings.enabled, settings.mode, settings.allowCrossSiteDocumentPrefetch,
      settings.respectSaveData, settings.respectNoPrefetch, settings.blockSensitiveUrls, settings.blockedHosts]);
    var wasLoaded = settingsLoaded;
    settingsLoaded = true;
    if (wasLoaded && previous === next) return;
    config = activeConfig();
    suspendWork();
    schedulePageWork();
  }

  function activeConfig() {
    if (settings.respectSaveData && shared.isNetworkConstrained()) {
      return shared.modeConfig("efficiency");
    }
    return shared.modeConfig(settings.mode);
  }

  function isActive() {
    if (!settingsLoaded || pageHidden) return false;
    if (!settings.enabled) return false;
    if (!shared.classifyPage(location.href, settings).ok) return false;
    if (settings.respectNoPrefetch && shared.pageDisablesPrefetch(document)) return false;
    if (document.visibilityState === "hidden") return false;
    return true;
  }

  function isTracking() {
    return settings.liveCacheTracking === true;
  }

  function getAnchor(target) {
    if (!target) return null;
    var element = target.nodeType === 1 ? target : target.parentElement;
    if (!element || !element.closest) return null;
    return element.closest("a[href]");
  }

  function idle(callback, timeout) {
    if (idleTimer) return;
    var revision = workRevision;
    function run() {
      idleTimer = 0;
      if (revision === workRevision && config.idleScan) callback();
    }
    if ("requestIdleCallback" in window) {
      idleIsNative = true;
      idleTimer = window.requestIdleCallback(run, { timeout: timeout || 1200 });
    } else {
      idleIsNative = false;
      idleTimer = window.setTimeout(run, Math.min(timeout || 800, 1200));
    }
  }

  function withHead(callback) {
    var head = document.head || document.getElementsByTagName("head")[0];
    if (head) {
      callback(head);
      return;
    }
    var revision = workRevision;
    document.addEventListener("DOMContentLoaded", function () {
      if (revision === workRevision && isActive()) callback(document.head || document.documentElement);
    }, { once: true });
  }

  function trackHint(link) {
    state.hintElements.push(link);
    while (state.hintElements.length > config.maxHintElements) {
      var old = state.hintElements.shift();
      if (old && old.parentNode) old.parentNode.removeChild(old);
    }
  }

  function addHint(rel, href, reason) {
    var key = rel + ":" + href;
    if (state.hintKeys.has(key)) return false;
    state.hintKeys.add(key);
    withHead(function (head) {
      var link = document.createElement("link");
      link.rel = rel;
      link.href = href;
      link.dataset.fireload = reason || "hint";
      if (rel === "prefetch") {
        link.as = "document";
        link.referrerPolicy = "strict-origin-when-cross-origin";
      }
      head.appendChild(link);
      trackHint(link);
    });
    return true;
  }

  function warmOrigin(url, reason) {
    if (!isActive()) return;
    if (url.origin === location.origin) return;
    if (!state.warmedOrigins.has(url.origin) && state.warmedOrigins.size >= config.maxOriginHints) return;

    var origin = url.protocol + "//" + url.host;
    var warmedSomething = false;
    if (config.dnsPrefetch) {
      warmedSomething = addHint("dns-prefetch", origin, reason) || warmedSomething;
      if (warmedSomething && isTracking()) state.stats.dnsPrefetches += 1;
    }
    if (config.preconnect && (shared.INTENT_REASONS[reason] || config.preconnectVisible)) {
      var didPreconnect = addHint("preconnect", origin, reason);
      if (didPreconnect && isTracking()) state.stats.preconnects += 1;
      warmedSomething = didPreconnect || warmedSomething;
    }
    if (warmedSomething) state.warmedOrigins.add(url.origin);
  }

  function allowsDocumentPrefetch(candidate, reason, force) {
    if (state.prefetched.size >= config.maxDocumentPrefetches) return false;
    if (candidate.sameOrigin) return true;
    if (!settings.allowCrossSiteDocumentPrefetch) return false;
    if (force && shared.INTENT_REASONS[reason]) return true;
    if (force && config.crossOriginOnIntent) return true;
    if (config.crossOriginDocumentPrefetch) return true;
    return Boolean(config.crossOriginOnIntent && shared.INTENT_REASONS[reason]);
  }

  function enqueueDocument(url, reason, force) {
    var key = shared.cacheKey(url);
    if (state.prefetched.has(key)) return;
    if (state.queued.has(key)) {
      if (force) {
        var index = state.queue.findIndex(function (job) { return job.key === key; });
        var existing = state.queue.splice(index, 1)[0];
        existing.reason = reason;
        existing.force = true;
        state.queue.unshift(existing);
        drainQueue();
      }
      return;
    }
    if (state.queue.length >= config.maxQueue || state.prefetched.size + state.queue.length >= config.maxDocumentPrefetches) {
      if (!force) return;
      // Explicit intent can replace a speculative job without expanding the budget.
      var replacement = state.queue.findLastIndex(function (job) { return !job.force; });
      if (replacement < 0) return;
      state.queued.delete(state.queue.splice(replacement, 1)[0].key);
    }

    var job = { url: url, key: key, reason: reason, force: force };
    state.queued.add(key);
    if (force) state.queue.unshift(job);
    else state.queue.push(job);
    drainQueue();
  }

  function drainQueue() {
    if (!isActive()) return;
    while (state.inFlight < config.maxInFlight && state.queue.length > 0) {
      var job = state.queue.shift();
      state.queued.delete(job.key);
      if (state.prefetched.has(job.key)) continue;
      var candidate = shared.classifyUrl(job.url.href, location.href, settings);
      if (!candidate.ok || !allowsDocumentPrefetch(candidate, job.reason, job.force)) continue;

      state.inFlight += 1;
      state.prefetched.add(job.key);
      if (isTracking()) {
        state.stats.documentPrefetches += 1;
        state.stats.lastReason = job.reason;
      }
      insertDocumentPrefetch(job);
    }
  }

  function insertDocumentPrefetch(job) {
    var done = false;
    var timeoutId = 0;
    var link = null;

    function finish(cancelled) {
      if (done) return;
      done = true;
      window.clearTimeout(timeoutId);
      state.requests.delete(cancel);
      if (link) {
        link.removeEventListener("load", complete);
        link.removeEventListener("error", complete);
        if (cancelled && link.parentNode) link.parentNode.removeChild(link);
      }
      state.inFlight = Math.max(0, state.inFlight - 1);
      if (!cancelled) drainQueue();
    }

    function complete() { finish(false); }
    function cancel() { finish(true); }
    state.requests.add(cancel);
    withHead(function (head) {
      link = document.createElement("link");
      link.rel = "prefetch";
      link.as = "document";
      link.href = job.url.href;
      link.referrerPolicy = "strict-origin-when-cross-origin";
      link.dataset.fireload = job.reason;
      link.addEventListener("load", complete, { once: true });
      link.addEventListener("error", complete, { once: true });
      timeoutId = window.setTimeout(complete, config.prefetchTimeoutMs);
      head.appendChild(link);
      trackHint(link);
    });
  }

  function prefetchAnchor(anchor, reason, force) {
    if (!isActive()) return;
    var candidate = shared.classifyAnchor(anchor, location.href, settings);
    if (!candidate.ok) {
      if (isTracking()) state.stats.skipped += 1;
      return;
    }

    warmOrigin(candidate.url, reason);
    if (allowsDocumentPrefetch(candidate, reason, force)) {
      enqueueDocument(candidate.url, reason, force);
    }
  }

  function warmAnchor(anchor, reason) {
    if (!isActive()) return;
    var candidate = shared.classifyAnchor(anchor, location.href, settings);
    if (candidate.ok) warmOrigin(candidate.url, reason);
  }

  function clearHoverTimer(anchor) {
    var timer = hoverTimers.get(anchor);
    if (timer) {
      window.clearTimeout(timer);
      hoverTimers.delete(anchor);
    }
  }

  function onMouseOver(event) {
    var anchor = getAnchor(event.target);
    if (!anchor || !isActive()) return;
    if (event.relatedTarget && anchor.contains(event.relatedTarget)) return;
    warmAnchor(anchor, "hover");
    clearHoverTimer(anchor);
    hoverTimers.set(anchor, window.setTimeout(function () {
      prefetchAnchor(anchor, "hover", true);
      hoverTimers.delete(anchor);
    }, config.hoverDelayMs));
  }

  function onMouseOut(event) {
    var anchor = getAnchor(event.target);
    if (anchor && (!event.relatedTarget || !anchor.contains(event.relatedTarget))) clearHoverTimer(anchor);
  }

  function onFocusIn(event) {
    var anchor = getAnchor(event.target);
    if (!anchor || !isActive()) return;
    warmAnchor(anchor, "focus");
    clearHoverTimer(anchor);
    hoverTimers.set(anchor, window.setTimeout(function () {
      prefetchAnchor(anchor, "focus", true);
      hoverTimers.delete(anchor);
    }, config.hoverDelayMs));
  }

  function onTouchStart(event) {
    var anchor = getAnchor(event.target);
    if (!anchor || !isActive()) return;
    warmAnchor(anchor, "touch");
    clearHoverTimer(anchor);
    hoverTimers.set(anchor, window.setTimeout(function () {
      prefetchAnchor(anchor, "touch", true);
      hoverTimers.delete(anchor);
    }, config.touchDelayMs));
  }

  function onContextMenu(event) {
    var anchor = getAnchor(event.target);
    if (anchor) prefetchAnchor(anchor, "contextmenu", true);
  }

  function onPointerDown(event) {
    var anchor = getAnchor(event.target);
    if (!anchor) return;
    if (event.button === 1 || event.ctrlKey || event.metaKey || event.shiftKey) {
      prefetchAnchor(anchor, "pointerdown", true);
    }
  }

  function onMouseDown(event) {
    var anchor = getAnchor(event.target);
    if (anchor) prefetchAnchor(anchor, "mousedown", true);
  }

  function onAuxClick(event) {
    var anchor = getAnchor(event.target);
    if (anchor && event.button === 1) prefetchAnchor(anchor, "auxclick", true);
  }

  function onClick(event) {
    var anchor = getAnchor(event.target);
    if (anchor) prefetchAnchor(anchor, "click", true);
  }

  function onKeyDown(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    var anchor = getAnchor(event.target);
    if (anchor) prefetchAnchor(anchor, "keyboard", Boolean(event.ctrlKey || event.metaKey || event.shiftKey));
  }

  function topCandidates() {
    var anchors = Array.prototype.slice.call(document.links || [], 0, config.maxScanAnchors);
    var candidates = [];
    for (var i = 0; i < anchors.length; i += 1) {
      var anchor = anchors[i];
      if (!shared.isVisibleAnchor(anchor)) continue;
      var candidate = shared.classifyAnchor(anchor, location.href, settings);
      if (!candidate.ok) continue;
      var score = shared.scoreAnchor(anchor, candidate.url, location.href);
      if (score >= config.minScore) {
        candidates.push({ anchor: anchor, candidate: candidate, score: score });
      }
    }
    candidates.sort(function (a, b) {
      return b.score - a.score;
    });
    return candidates;
  }

  function scanPage(reason) {
    if (!isActive()) return;
    var candidates = topCandidates();
    var warmCount = Math.min(config.maxWarmCandidates, candidates.length);
    var prefetchCount = Math.min(config.maxIdlePrefetches, candidates.length);

    for (var i = 0; i < warmCount; i += 1) {
      warmOrigin(candidates[i].candidate.url, reason);
    }
    for (var j = 0; j < prefetchCount; j += 1) {
      if (allowsDocumentPrefetch(candidates[j].candidate, reason, false)) {
        enqueueDocument(candidates[j].candidate.url, reason, false);
      }
    }
  }

  function setupIntersectionObserver() {
    if (!config.viewportPrefetch || !("IntersectionObserver" in window)) return;
    var currentObserver = new IntersectionObserver(function (entries) {
      if (observer !== currentObserver || !isActive()) return;
      for (var i = 0; i < entries.length; i += 1) {
        if (!entries[i].isIntersecting) continue;
        var anchor = entries[i].target;
        currentObserver.unobserve(anchor);
        warmAnchor(anchor, "visible");
        if (config.visibleDocumentPrefetch) prefetchAnchor(anchor, "visible", false);
      }
    }, {
      rootMargin: config.viewportRootMargin,
      threshold: 0.01
    });
    observer = currentObserver;

    var anchors = Array.prototype.slice.call(document.links || [], 0, config.maxObservedAnchors);
    for (var i = 0; i < anchors.length; i += 1) {
      if (shared.classifyAnchor(anchors[i], location.href, settings).ok) {
        observer.observe(anchors[i]);
      }
    }
  }

  function setupMutationObserver() {
    if (!config.observeMutations || !("MutationObserver" in window) || !document.documentElement) return;
    mutationObserver = new MutationObserver(function (records) {
      // Ignore our own hints and text-only updates; neither changes link candidates.
      var relevant = records.some(function (record) {
        if (record.type === "attributes") return true;
        return Array.prototype.some.call(record.addedNodes, isPageElement) ||
          Array.prototype.some.call(record.removedNodes, isPageElement);
      });
      if (!relevant) return;
      if (mutationTimer) return;
      mutationTimer = window.setTimeout(function () {
        mutationTimer = 0;
        resetObservers();
        schedulePageWork();
      }, settings.mode === "blazing" ? 900 : 2400);
    });
    mutationObserver.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["href", "rel", "download"]
    });
  }

  function isPageElement(node) {
    return node.nodeType === 1 && !(node.tagName === "LINK" && node.dataset && node.dataset.fireload);
  }

  function resetObservers() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }
    if (mutationTimer) {
      window.clearTimeout(mutationTimer);
      mutationTimer = 0;
    }
  }

  function suspendWork() {
    workRevision += 1;
    resetObservers();
    if (idleTimer) {
      if (idleIsNative) window.cancelIdleCallback(idleTimer);
      else window.clearTimeout(idleTimer);
      idleTimer = 0;
    }
    hoverTimers.forEach(function (timer) { window.clearTimeout(timer); });
    hoverTimers.clear();
    state.queue.length = 0;
    state.queued.clear();
    state.requests.forEach(function (cancel) { cancel(); });
    state.hintElements.forEach(function (link) {
      if (link.parentNode) link.parentNode.removeChild(link);
    });
    state.hintElements.length = 0;
  }

  function schedulePageWork() {
    if (!isActive()) return;
    if (document.readyState === "loading") return;
    resetObservers();
    setupIntersectionObserver();
    setupMutationObserver();
    if (config.idleScan) {
      idle(function () {
        scanPage("idle");
      }, settings.mode === "blazing" ? 550 : 1200);
    }
  }

  function pageStatus() {
    var page = shared.classifyPage(location.href, settings);
    if (!settingsLoaded) return "settings unavailable";
    if (!settings.enabled) return "disabled";
    if (!page.ok) return page.reason;
    if (settings.respectNoPrefetch && shared.pageDisablesPrefetch(document)) return "page opt-out";
    if (settings.respectSaveData && shared.isNetworkConstrained()) return "network saver";
    if (document.visibilityState === "hidden") return "hidden";
    return "active";
  }

  function summary() {
    return {
      enabled: isActive(),
      tracking: isTracking(),
      status: pageStatus(),
      configuredMode: settings.mode,
      activeMode: config.label,
      queued: state.queue.length,
      inFlight: state.inFlight,
      prefetched: state.stats.documentPrefetches,
      warmedOrigins: state.warmedOrigins.size,
      dnsPrefetches: state.stats.dnsPrefetches,
      preconnects: state.stats.preconnects,
      skipped: state.stats.skipped,
      lastReason: state.stats.lastReason,
      uptimeMs: Date.now() - startedAt
    };
  }

  document.addEventListener("mouseover", onMouseOver, true);
  document.addEventListener("mouseout", onMouseOut, true);
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("focusout", onMouseOut, true);
  document.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
  document.addEventListener("contextmenu", onContextMenu, true);
  if ("PointerEvent" in window) {
    document.addEventListener("pointerdown", onPointerDown, true);
  }
  document.addEventListener("mousedown", onMouseDown, true);
  document.addEventListener("auxclick", onAuxClick, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("DOMContentLoaded", schedulePageWork, { once: true });
  document.addEventListener("visibilitychange", function () {
    suspendWork();
    config = activeConfig();
    schedulePageWork();
  });
  window.addEventListener("pagehide", function () { pageHidden = true; suspendWork(); });
  window.addEventListener("pageshow", function () { pageHidden = false; schedulePageWork(); });
  var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (connection && connection.addEventListener) {
    connection.addEventListener("change", function () {
      suspendWork();
      config = activeConfig();
      schedulePageWork();
    });
  }

  api.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName === "local" && changes[shared.STORAGE_KEY]) {
      settingsRevision += 1;
      applySettings(changes[shared.STORAGE_KEY].newValue);
    }
  });

  api.runtime.onMessage.addListener(function (message, sender) {
    if (
      shared.isAllowedExtensionMessage(message, [shared.MESSAGE.GET_PAGE_SUMMARY]) &&
      shared.isSafeExtensionPageSender(sender, extensionBase, { popup: true })
    ) {
      return Promise.resolve(summary());
    }
    return undefined;
  });

  loadSettings();
}).call(typeof globalThis !== "undefined" ? globalThis : this);
