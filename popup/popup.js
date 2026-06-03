(function () {
  "use strict";

  var api = typeof browser !== "undefined" ? browser : null;
  var shared = this.FireLoadShared;
  if (!api || !shared) return;

  var settings = shared.normalizeSettings();
  var elements = {};
  var pollTimer = 0;
  var refreshInFlight = false;

  function qs(selector) {
    return document.querySelector(selector);
  }

  function setSaveState(text) {
    elements.saveState.textContent = text;
    if (text) {
      window.setTimeout(function () {
        if (elements.saveState.textContent === text) elements.saveState.textContent = "";
      }, 1400);
    }
  }

  function getSettings() {
    return api.runtime.sendMessage({ type: shared.MESSAGE.GET_SETTINGS }).then(shared.normalizeSettings);
  }

  function saveSettings(patch) {
    return api.runtime.sendMessage({ type: shared.MESSAGE.SAVE_SETTINGS, patch: patch }).then(function (next) {
      settings = shared.normalizeSettings(next);
      renderSettings();
      setSaveState("Saved");
      window.setTimeout(refreshSummary, 120);
    });
  }

  function renderSettings() {
    var config = shared.modeConfig(settings.mode);
    elements.enabledToggle.checked = settings.enabled;
    elements.statusText.textContent = settings.enabled ? config.label : "Disabled";
    document.querySelectorAll(".mode-button").forEach(function (button) {
      button.setAttribute("aria-pressed", String(button.dataset.mode === settings.mode));
    });
  }

  function renderSummary(summary) {
    if (!summary) {
      elements.pageStatus.textContent = "Unavailable";
      elements.prefetchedCount.textContent = "0";
      elements.originCount.textContent = "0";
      elements.queueCount.textContent = "0";
      elements.dnsCount.textContent = "0";
      elements.connectCount.textContent = "0";
      elements.skippedCount.textContent = "0";
      elements.lastReason.textContent = "none";
      return;
    }
    elements.pageStatus.textContent = summary.status || "active";
    elements.prefetchedCount.textContent = String(summary.prefetched || 0);
    elements.originCount.textContent = String(summary.warmedOrigins || 0);
    elements.queueCount.textContent = String((summary.queued || 0) + (summary.inFlight || 0));
    elements.dnsCount.textContent = String(summary.dnsPrefetches || 0);
    elements.connectCount.textContent = String(summary.preconnects || 0);
    elements.skippedCount.textContent = String(summary.skipped || 0);
    elements.lastReason.textContent = summary.lastReason || "none";
  }

  function refreshSummary() {
    if (refreshInFlight) return Promise.resolve();
    refreshInFlight = true;
    return api.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
      if (!tabs || !tabs[0] || tabs[0].id == null) return null;
      return api.tabs.sendMessage(tabs[0].id, { type: shared.MESSAGE.GET_PAGE_SUMMARY });
    }).then(renderSummary).catch(function () {
      renderSummary(null);
    }).finally(function () {
      refreshInFlight = false;
    });
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = window.setInterval(refreshSummary, 350);
  }

  function stopPolling() {
    if (!pollTimer) return;
    window.clearInterval(pollTimer);
    pollTimer = 0;
  }

  function bindEvents() {
    elements.enabledToggle.addEventListener("change", function () {
      saveSettings({ enabled: elements.enabledToggle.checked });
    });

    document.querySelectorAll(".mode-button").forEach(function (button) {
      button.addEventListener("click", function () {
        saveSettings({ mode: button.dataset.mode });
      });
    });

    elements.optionsButton.addEventListener("click", function () {
      api.runtime.openOptionsPage();
    });
  }

  function init() {
    elements.enabledToggle = qs("#enabledToggle");
    elements.statusText = qs("#statusText");
    elements.pageStatus = qs("#pageStatus");
    elements.prefetchedCount = qs("#prefetchedCount");
    elements.originCount = qs("#originCount");
    elements.queueCount = qs("#queueCount");
    elements.dnsCount = qs("#dnsCount");
    elements.connectCount = qs("#connectCount");
    elements.skippedCount = qs("#skippedCount");
    elements.lastReason = qs("#lastReason");
    elements.optionsButton = qs("#optionsButton");
    elements.saveState = qs("#saveState");

    bindEvents();
    getSettings().then(function (loaded) {
      settings = loaded;
      renderSettings();
      return refreshSummary();
    }).then(function () {
      startPolling();
    }).catch(function () {
      renderSettings();
      renderSummary(null);
      startPolling();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
  window.addEventListener("pagehide", stopPolling);
}).call(typeof globalThis !== "undefined" ? globalThis : this);
