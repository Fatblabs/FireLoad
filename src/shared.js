(function (global) {
  "use strict";

  var STORAGE_KEY = "fireloadSettings";
  var MESSAGE = {
    GET_SETTINGS: "FIRELOAD_GET_SETTINGS",
    SAVE_SETTINGS: "FIRELOAD_SAVE_SETTINGS",
    GET_PAGE_SUMMARY: "FIRELOAD_GET_PAGE_SUMMARY"
  };

  var DEFAULT_SETTINGS = {
    enabled: true,
    mode: "balanced",
    respectSaveData: true,
    respectNoPrefetch: true,
    blockSensitiveUrls: true,
    blockedHosts: []
  };

  var MODE_CONFIGS = {
    efficiency: {
      label: "Efficiency",
      badge: "ECO",
      maxDocumentPrefetches: 4,
      maxInFlight: 1,
      maxQueue: 6,
      hoverDelayMs: 140,
      touchDelayMs: 80,
      idleScan: false,
      viewportPrefetch: false,
      observeMutations: false,
      maxScanAnchors: 24,
      maxObservedAnchors: 0,
      maxWarmCandidates: 2,
      maxIdlePrefetches: 0,
      maxOriginHints: 2,
      maxHintElements: 24,
      dnsPrefetch: true,
      preconnect: false,
      preconnectVisible: false,
      crossOriginOnIntent: false,
      crossOriginDocumentPrefetch: false,
      visibleDocumentPrefetch: false,
      viewportRootMargin: "120px",
      minScore: 55,
      prefetchTimeoutMs: 4500
    },
    balanced: {
      label: "Balanced",
      badge: "BAL",
      maxDocumentPrefetches: 12,
      maxInFlight: 2,
      maxQueue: 18,
      hoverDelayMs: 70,
      touchDelayMs: 35,
      idleScan: true,
      viewportPrefetch: true,
      observeMutations: true,
      maxScanAnchors: 90,
      maxObservedAnchors: 120,
      maxWarmCandidates: 6,
      maxIdlePrefetches: 3,
      maxOriginHints: 6,
      maxHintElements: 64,
      dnsPrefetch: true,
      preconnect: true,
      preconnectVisible: false,
      crossOriginOnIntent: true,
      crossOriginDocumentPrefetch: false,
      visibleDocumentPrefetch: true,
      viewportRootMargin: "420px",
      minScore: 42,
      prefetchTimeoutMs: 6500
    },
    blazing: {
      label: "Blazing Fast",
      badge: "MAX",
      maxDocumentPrefetches: 36,
      maxInFlight: 6,
      maxQueue: 60,
      hoverDelayMs: 12,
      touchDelayMs: 0,
      idleScan: true,
      viewportPrefetch: true,
      observeMutations: true,
      maxScanAnchors: 240,
      maxObservedAnchors: 360,
      maxWarmCandidates: 18,
      maxIdlePrefetches: 12,
      maxOriginHints: 18,
      maxHintElements: 160,
      dnsPrefetch: true,
      preconnect: true,
      preconnectVisible: true,
      crossOriginOnIntent: true,
      crossOriginDocumentPrefetch: true,
      visibleDocumentPrefetch: true,
      viewportRootMargin: "950px",
      minScore: 28,
      prefetchTimeoutMs: 9500
    }
  };

  var INTENT_REASONS = {
    auxclick: true,
    contextmenu: true,
    hover: true,
    focus: true,
    keyboard: true,
    pointerdown: true,
    touch: true,
    mousedown: true,
    click: true
  };

  var STATIC_FILE_RE = /\.(?:7z|apk|avi|avif|bin|bz2|css|csv|dmg|doc|docx|eot|exe|gif|gz|ico|iso|jpeg|jpg|js|json|m4v|mov|mp3|mp4|mpeg|mpg|ogg|otf|pdf|png|ppt|pptx|rar|rss|svg|tar|tgz|ttf|txt|wav|webm|webp|woff|woff2|xls|xlsx|xml|zip)(?:[?#]|$)/i;
  var SENSITIVE_TOKEN_RE = /(^|[/?#&=._-])(?:admin|auth|basket|buy|cancel|cart|checkout|csrf|delete|destroy|impersonate|logoff|logout|mfa|nonce|oauth|order|password|pay|payment|purchase|refund|remove|reset|saml|session|signout|subscription|switch-user|token|unsubscribe|void|2fa)(?=$|[/?#&=._-])/i;
  var SENSITIVE_QUERY_KEY_RE = /^(?:access_token|auth|authenticity_token|code|csrf|key|nonce|pass|password|secret|session|sid|sig|signature|state|token)$/i;
  var SKIPPED_SCHEME_RE = /^(?:about|blob|chrome|data|file|ftp|javascript|mailto|moz-extension|sms|tel|view-source):/i;
  var REL_SKIP_RE = /\b(?:nofollow|sponsored|ugc)\b/i;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function modeConfig(mode) {
    return clone(MODE_CONFIGS[mode] || MODE_CONFIGS[DEFAULT_SETTINGS.mode]);
  }

  function cleanHost(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");
  }

  function normalizeSettings(raw) {
    var source = raw && typeof raw === "object" ? raw : {};
    var settings = Object.assign({}, DEFAULT_SETTINGS, source);
    settings.mode = MODE_CONFIGS[settings.mode] ? settings.mode : DEFAULT_SETTINGS.mode;
    settings.enabled = settings.enabled !== false;
    settings.respectSaveData = settings.respectSaveData !== false;
    settings.respectNoPrefetch = settings.respectNoPrefetch !== false;
    settings.blockSensitiveUrls = settings.blockSensitiveUrls !== false;
    settings.blockedHosts = Array.isArray(settings.blockedHosts)
      ? settings.blockedHosts.map(cleanHost).filter(Boolean)
      : [];
    return settings;
  }

  function isNetworkConstrained() {
    if (!global.navigator) return false;
    var connection = global.navigator.connection || global.navigator.mozConnection || global.navigator.webkitConnection;
    if (!connection) return false;
    if (connection.saveData) return true;
    return /(^|-)2g$/i.test(connection.effectiveType || "");
  }

  function pageDisablesPrefetch(doc) {
    if (!doc || !doc.querySelectorAll) return false;
    var metas = doc.querySelectorAll("meta[http-equiv]");
    for (var i = 0; i < metas.length; i += 1) {
      var name = (metas[i].getAttribute("http-equiv") || "").toLowerCase();
      var value = (metas[i].getAttribute("content") || "").toLowerCase();
      if (name === "x-dns-prefetch-control" && value === "off") return true;
    }
    return false;
  }

  function toUrl(value, baseHref) {
    if (!value || SKIPPED_SCHEME_RE.test(String(value).trim())) return null;
    try {
      return new URL(value, baseHref);
    } catch (error) {
      return null;
    }
  }

  function cacheKey(url) {
    return url.origin + url.pathname + url.search;
  }

  function hostMatches(hostname, blockedHost) {
    if (!blockedHost) return false;
    var host = hostname.toLowerCase();
    var blocked = blockedHost.toLowerCase();
    if (blocked.indexOf("*.") === 0) {
      var suffix = blocked.slice(1);
      return host.endsWith(suffix);
    }
    if (blocked.indexOf(".") === 0) {
      return host === blocked.slice(1) || host.endsWith(blocked);
    }
    return host === blocked;
  }

  function isBlockedHost(hostname, blockedHosts) {
    for (var i = 0; i < blockedHosts.length; i += 1) {
      if (hostMatches(hostname, blockedHosts[i])) return true;
    }
    return false;
  }

  function hasSensitiveQuery(url) {
    var found = false;
    url.searchParams.forEach(function (_value, key) {
      if (SENSITIVE_QUERY_KEY_RE.test(key)) found = true;
    });
    return found;
  }

  function isSensitiveUrl(url) {
    return SENSITIVE_TOKEN_RE.test(url.pathname + url.search + url.hash) || hasSensitiveQuery(url);
  }

  function classifyUrl(href, baseHref, settings) {
    var normalized = normalizeSettings(settings);
    var url = toUrl(href, baseHref);
    var current = toUrl(baseHref, baseHref);

    if (!url || !current) return { ok: false, reason: "invalid" };
    if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "protocol" };
    if (url.username || url.password) return { ok: false, reason: "credentials" };
    if (href.length > 2048) return { ok: false, reason: "length" };
    if (url.origin === current.origin && url.pathname === current.pathname && url.search === current.search) {
      return { ok: false, reason: "same-document" };
    }
    if (STATIC_FILE_RE.test(url.pathname)) return { ok: false, reason: "static" };
    if (isBlockedHost(url.hostname, normalized.blockedHosts)) return { ok: false, reason: "blocked-host" };
    if (normalized.blockSensitiveUrls && isSensitiveUrl(url)) return { ok: false, reason: "sensitive" };

    return {
      ok: true,
      url: url,
      key: cacheKey(url),
      sameOrigin: url.origin === current.origin
    };
  }

  function classifyAnchor(anchor, baseHref, settings) {
    if (!anchor || !anchor.href) return { ok: false, reason: "missing" };
    if (anchor.hasAttribute && anchor.hasAttribute("download")) return { ok: false, reason: "download" };
    if (REL_SKIP_RE.test(anchor.getAttribute ? anchor.getAttribute("rel") || "" : "")) {
      return { ok: false, reason: "rel" };
    }
    return classifyUrl(anchor.href, baseHref, settings);
  }

  function anchorRect(anchor) {
    if (!anchor || !anchor.getBoundingClientRect) return null;
    try {
      return anchor.getBoundingClientRect();
    } catch (error) {
      return null;
    }
  }

  function isVisibleAnchor(anchor) {
    var rect = anchorRect(anchor);
    if (!rect) return false;
    return rect.width >= 4 && rect.height >= 4 && rect.bottom >= 0 && rect.right >= 0;
  }

  function scoreAnchor(anchor, url, currentHref) {
    var current = toUrl(currentHref, currentHref);
    var score = 0;
    var rect = anchorRect(anchor);
    var text = ((anchor.textContent || "") + " " + (anchor.getAttribute("aria-label") || "")).trim().toLowerCase();
    var rel = (anchor.getAttribute("rel") || "").toLowerCase();

    if (!current || !rect) return 0;
    if (url.origin === current.origin) score += 36;
    if (url.hostname === current.hostname) score += 14;
    if (url.pathname.split("/")[1] && url.pathname.split("/")[1] === current.pathname.split("/")[1]) score += 10;
    if (rel.indexOf("next") >= 0) score += 60;
    if (/\b(?:next|continue|more|details|view|product|article|read)\b/.test(text)) score += 18;
    if (/\b(?:login|sign in|register|subscribe|ad|sponsored)\b/.test(text)) score -= 16;
    if (anchor.target && anchor.target !== "_self") score -= 8;
    if (rect.top >= -40 && rect.top <= global.innerHeight + 200) score += 22;
    if (rect.left >= -40 && rect.left <= global.innerWidth + 80) score += 8;
    if (rect.width * rect.height > 1600) score += 6;
    if (url.search && url.origin !== current.origin) score -= 8;
    return score;
  }

  global.FireLoadShared = {
    STORAGE_KEY: STORAGE_KEY,
    MESSAGE: MESSAGE,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    MODE_CONFIGS: MODE_CONFIGS,
    INTENT_REASONS: INTENT_REASONS,
    normalizeSettings: normalizeSettings,
    modeConfig: modeConfig,
    isNetworkConstrained: isNetworkConstrained,
    pageDisablesPrefetch: pageDisablesPrefetch,
    classifyUrl: classifyUrl,
    classifyAnchor: classifyAnchor,
    isVisibleAnchor: isVisibleAnchor,
    scoreAnchor: scoreAnchor,
    cacheKey: cacheKey
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
