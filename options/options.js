(function () {
  "use strict";

  var api = typeof browser !== "undefined" ? browser : null;
  var shared = this.FireLoadShared;
  if (!api || !shared) return;

  var settings = shared.normalizeSettings();
  var fields = {};

  function qs(selector) {
    return document.querySelector(selector);
  }

  function normalizeSettingsResponse(value) {
    if (!value || typeof value !== "object") throw new Error("Invalid settings response.");
    return shared.normalizeSettings(value);
  }

  function getSettings() {
    return api.runtime.sendMessage({ type: shared.MESSAGE.GET_SETTINGS }).then(normalizeSettingsResponse);
  }

  function saveSettings(patch) {
    return api.runtime.sendMessage({ type: shared.MESSAGE.SAVE_SETTINGS, patch: patch }).then(function (next) {
      settings = normalizeSettingsResponse(next);
      render();
      showSaved("Saved");
    }).catch(function () {
      render();
      showSaved("Not saved");
    });
  }

  function showSaved(text) {
    fields.saveState.textContent = text;
    window.setTimeout(function () {
      if (fields.saveState.textContent === text) fields.saveState.textContent = "";
    }, 1600);
  }

  function selectedMode() {
    var active = qs(".mode-row button[aria-pressed='true']");
    return active ? active.dataset.mode : settings.mode;
  }

  function collect() {
    return {
      enabled: fields.enabled.checked,
      mode: selectedMode(),
      liveCacheTracking: fields.liveCacheTracking.checked,
      allowCrossSiteDocumentPrefetch: fields.allowCrossSiteDocumentPrefetch.checked,
      respectSaveData: fields.respectSaveData.checked,
      respectNoPrefetch: fields.respectNoPrefetch.checked,
      blockSensitiveUrls: fields.blockSensitiveUrls.checked,
      blockedHosts: fields.blockedHosts.value.split(/\n+/).map(function (line) {
        return line.trim();
      }).filter(Boolean)
    };
  }

  function render() {
    fields.enabled.checked = settings.enabled;
    fields.liveCacheTracking.checked = settings.liveCacheTracking;
    fields.allowCrossSiteDocumentPrefetch.checked = settings.allowCrossSiteDocumentPrefetch;
    fields.respectSaveData.checked = settings.respectSaveData;
    fields.respectNoPrefetch.checked = settings.respectNoPrefetch;
    fields.blockSensitiveUrls.checked = settings.blockSensitiveUrls;
    fields.blockedHosts.value = settings.blockedHosts.join("\n");
    document.querySelectorAll(".mode-row button").forEach(function (button) {
      button.setAttribute("aria-pressed", String(button.dataset.mode === settings.mode));
    });
  }

  function bind() {
    document.querySelectorAll(".mode-row button").forEach(function (button) {
      button.addEventListener("click", function () {
        document.querySelectorAll(".mode-row button").forEach(function (item) {
          item.setAttribute("aria-pressed", "false");
        });
        button.setAttribute("aria-pressed", "true");
        saveSettings({ mode: button.dataset.mode });
      });
    });

    [fields.enabled, fields.liveCacheTracking, fields.allowCrossSiteDocumentPrefetch, fields.respectSaveData, fields.respectNoPrefetch, fields.blockSensitiveUrls].forEach(function (field) {
      field.addEventListener("change", function () {
        saveSettings(collect());
      });
    });

    fields.saveButton.addEventListener("click", function () {
      saveSettings(collect());
    });
  }

  function init() {
    fields.enabled = qs("#enabled");
    fields.liveCacheTracking = qs("#liveCacheTracking");
    fields.allowCrossSiteDocumentPrefetch = qs("#allowCrossSiteDocumentPrefetch");
    fields.respectSaveData = qs("#respectSaveData");
    fields.respectNoPrefetch = qs("#respectNoPrefetch");
    fields.blockSensitiveUrls = qs("#blockSensitiveUrls");
    fields.blockedHosts = qs("#blockedHosts");
    fields.saveButton = qs("#saveButton");
    fields.saveState = qs("#saveState");

    bind();
    getSettings().then(function (loaded) {
      settings = loaded;
      render();
    }).catch(function () {
      render();
      showSaved("Using defaults");
    });
  }

  document.addEventListener("DOMContentLoaded", init);
}).call(typeof globalThis !== "undefined" ? globalThis : this);
