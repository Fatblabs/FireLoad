(function () {
  "use strict";

  var api = typeof browser !== "undefined" ? browser : null;
  var shared = this.FireLoadShared;
  if (!api || !shared) return;

  var settings = shared.normalizeSettings();
  var fields = {};
  var saveRevision = 0;

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

  function setControlsDisabled(disabled) {
    Object.keys(fields).forEach(function (key) {
      if (key !== "saveState") fields[key].disabled = disabled;
    });
    document.querySelectorAll(".mode-row button").forEach(function (button) { button.disabled = disabled; });
  }

  function saveSettings(patch) {
    var revision = ++saveRevision;
    var hostsAtSave = fields.blockedHosts.value;
    return api.runtime.sendMessage({ type: shared.MESSAGE.SAVE_SETTINGS, patch: patch }).then(function (next) {
      if (revision !== saveRevision) return;
      settings = normalizeSettingsResponse(next);
      render(Boolean(patch.blockedHosts) && fields.blockedHosts.value === hostsAtSave);
      showSaved("Saved");
    }).catch(function () {
      if (revision !== saveRevision) return;
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

  function render(updateHosts) {
    fields.enabled.checked = settings.enabled;
    fields.liveCacheTracking.checked = settings.liveCacheTracking;
    fields.allowCrossSiteDocumentPrefetch.checked = settings.allowCrossSiteDocumentPrefetch;
    fields.respectSaveData.checked = settings.respectSaveData;
    fields.respectNoPrefetch.checked = settings.respectNoPrefetch;
    fields.blockSensitiveUrls.checked = settings.blockSensitiveUrls;
    if (updateHosts) fields.blockedHosts.value = settings.blockedHosts.join("\n");
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
        var patch = {};
        patch[field.id] = field.checked;
        saveSettings(patch);
      });
    });

    fields.saveButton.addEventListener("click", function () {
      saveSettings({ blockedHosts: fields.blockedHosts.value.split(/\n+/).map(function (line) {
        return line.trim();
      }).filter(Boolean) });
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

    setControlsDisabled(true);
    bind();
    getSettings().then(function (loaded) {
      settings = loaded;
      setControlsDisabled(false);
      render(true);
    }).catch(function () {
      render();
      showSaved("Settings unavailable");
    });
  }

  document.addEventListener("DOMContentLoaded", init);
}).call(typeof globalThis !== "undefined" ? globalThis : this);
