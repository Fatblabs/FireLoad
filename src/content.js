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
  var hoverTimers = new WeakMap();
  var extensionBase = api.runtime.getURL("");
  var state = {
    queue: [],
    queued: new Set(),
    inFlight: 0,
    prefetched: new Set(),
    warmedOrigins: new Set(),
    hintKeys: new Set(),
    hintElements: [],
    stats: {
      documentPrefetches: 0,
      dnsPrefetches: 0,
      preconnects: 0,
      skipped: 0,
      lastReason: "startup"
    }
  };

  function loadSettings() {
    return api.storage.local.get(shared.STORAGE_KEY).then(function (result) {
      applySettings(result[shared.STORAGE_KEY]);
    }).catch(function () {
      applySettings(settings);
    });
  }

  function applySettings(raw) {
    settings = shared.normalizeSettings(raw);
    config = activeConfig();
    resetObservers();
    schedulePageWork();
  }

  function activeConfig() {
    if (settings.respectSaveData && shared.isNetworkConstrained()) {
      return shared.modeConfig("efficiency");
    }
    return shared.modeConfig(settings.mode);
  }

  function isActive() {
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
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(callback, { timeout: timeout || 1200 });
    } else {
      window.setTimeout(callback, Math.min(timeout || 800, 1200));
    }
  }

  function withHead(callback) {
    var head = document.head || document.getElementsByTagName("head")[0];
    if (head) {
      callback(head);
      return;
    }
    document.addEventListener("DOMContentLoaded", function () {
      callback(document.head || document.documentElement);
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
    if (state.prefetched.has(key) || state.queued.has(key)) return;
    if (state.queue.length >= config.maxQueue) return;

    var job = { url: url, key: key, reason: reason };
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

    function finish() {
      if (done) return;
      done = true;
      window.clearTimeout(timeoutId);
      state.inFlight = Math.max(0, state.inFlight - 1);
      drainQueue();
    }

    withHead(function (head) {
      var link = document.createElement("link");
      link.rel = "prefetch";
      link.as = "document";
      link.href = job.url.href;
      link.referrerPolicy = "strict-origin-when-cross-origin";
      link.dataset.fireload = job.reason;
      link.addEventListener("load", finish, { once: true });
      link.addEventListener("error", finish, { once: true });
      head.appendChild(link);
      trackHint(link);
      timeoutId = window.setTimeout(finish, config.prefetchTimeoutMs);
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

  function onFocusIn(event) {
    var anchor = getAnchor(event.target);
    if (!anchor) return;
    warmAnchor(anchor, "focus");
    window.setTimeout(function () {
      prefetchAnchor(anchor, "focus", true);
    }, config.hoverDelayMs);
  }

  function onTouchStart(event) {
    var anchor = getAnchor(event.target);
    if (!anchor) return;
    warmAnchor(anchor, "touch");
    window.setTimeout(function () {
      prefetchAnchor(anchor, "touch", true);
    }, config.touchDelayMs);
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
    observer = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i += 1) {
        if (!entries[i].isIntersecting) continue;
        var anchor = entries[i].target;
        observer.unobserve(anchor);
        warmAnchor(anchor, "visible");
        if (config.visibleDocumentPrefetch) prefetchAnchor(anchor, "visible", false);
      }
    }, {
      rootMargin: config.viewportRootMargin,
      threshold: 0.01
    });

    var anchors = Array.prototype.slice.call(document.links || [], 0, config.maxObservedAnchors);
    for (var i = 0; i < anchors.length; i += 1) {
      if (shared.classifyAnchor(anchors[i], location.href, settings).ok) {
        observer.observe(anchors[i]);
      }
    }
  }

  function setupMutationObserver() {
    if (!config.observeMutations || !("MutationObserver" in window) || !document.documentElement) return;
    mutationObserver = new MutationObserver(function () {
      if (mutationTimer) return;
      mutationTimer = window.setTimeout(function () {
        mutationTimer = 0;
        resetObservers();
        schedulePageWork();
      }, settings.mode === "blazing" ? 900 : 2400);
    });
    mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
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

  function schedulePageWork() {
    if (!isActive()) return;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", schedulePageWork, { once: true });
      return;
    }
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
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
  document.addEventListener("contextmenu", onContextMenu, true);
  if ("PointerEvent" in window) {
    document.addEventListener("pointerdown", onPointerDown, true);
  }
  document.addEventListener("mousedown", onMouseDown, true);
  document.addEventListener("auxclick", onAuxClick, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);

  api.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName === "local" && changes[shared.STORAGE_KEY]) {
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
