(function () {
  "use strict";

  var api = typeof browser !== "undefined" ? browser : null;
  var shared = this.FireLoadShared;
  if (!api || !shared) return;
  var actionApi = api.action || api.browserAction;

  function getSettings() {
    return api.storage.local.get(shared.STORAGE_KEY).then(function (result) {
      return shared.normalizeSettings(result[shared.STORAGE_KEY]);
    });
  }

  function saveSettings(patch) {
    return getSettings().then(function (settings) {
      var next = shared.normalizeSettings(Object.assign({}, settings, patch || {}));
      return api.storage.local.set({ [shared.STORAGE_KEY]: next }).then(function () {
        updateBadge(next);
        return next;
      });
    });
  }

  function ensureSettings() {
    return getSettings().then(function (settings) {
      return api.storage.local.set({ [shared.STORAGE_KEY]: settings }).then(function () {
        updateBadge(settings);
      });
    });
  }

  function updateBadge(settings) {
    if (!actionApi) return;
    var normalized = shared.normalizeSettings(settings);
    var config = shared.modeConfig(normalized.mode);
    var text = normalized.enabled ? config.badge : "OFF";
    var color = normalized.enabled
      ? normalized.mode === "blazing"
        ? "#d53f2f"
        : normalized.mode === "efficiency"
          ? "#2f7d51"
          : "#525252"
      : "#777777";

    actionApi.setBadgeText({ text: text });
    actionApi.setBadgeBackgroundColor({ color: color });
  }

  api.runtime.onInstalled.addListener(ensureSettings);
  api.runtime.onStartup.addListener(ensureSettings);

  api.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName === "local" && changes[shared.STORAGE_KEY]) {
      updateBadge(changes[shared.STORAGE_KEY].newValue);
    }
  });

  api.runtime.onMessage.addListener(function (message) {
    if (!message || !message.type) return undefined;
    if (message.type === shared.MESSAGE.GET_SETTINGS) return getSettings();
    if (message.type === shared.MESSAGE.SAVE_SETTINGS) return saveSettings(message.patch);
    return undefined;
  });

  ensureSettings();
}).call(typeof globalThis !== "undefined" ? globalThis : this);
