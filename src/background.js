(function () {
  "use strict";

  var api = typeof browser !== "undefined" ? browser : null;
  var shared = this.FireLoadShared;
  if (!api || !shared) return;
  var actionApi = api.action || api.browserAction;
  var extensionBase = api.runtime.getURL("");
  var settingsWrites = Promise.resolve();

  // Serialize read/modify/write operations so simultaneous UI changes cannot overwrite each other.
  function writeSettings(operation) {
    var result = settingsWrites.then(operation);
    settingsWrites = result.catch(function () {});
    return result;
  }

  function getSettings() {
    return api.storage.local.get(shared.STORAGE_KEY).then(function (result) {
      return shared.normalizeSettings(result[shared.STORAGE_KEY]);
    });
  }

  function saveSettings(patch) {
    return writeSettings(function () {
      return getSettings().then(function (settings) {
        var next = shared.mergeSettings(settings, patch);
        return api.storage.local.set({ [shared.STORAGE_KEY]: next }).then(function () {
          updateBadge(next);
          return next;
        });
      });
    });
  }

  function ensureSettings() {
    return writeSettings(function () {
      return getSettings().then(function (settings) {
        return api.storage.local.set({ [shared.STORAGE_KEY]: settings }).then(function () {
          updateBadge(settings);
        });
      });
    });
  }

  function maybeOpenOnboarding(details) {
    if (!details || details.reason !== "install" || !api.tabs || !api.tabs.create) return;
    api.tabs.create({ url: api.runtime.getURL("onboarding/onboarding.html") }).catch(function () {});
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

    Promise.resolve(actionApi.setBadgeText({ text: text })).catch(function () {});
    Promise.resolve(actionApi.setBadgeBackgroundColor({ color: color })).catch(function () {});
  }

  api.runtime.onInstalled.addListener(function (details) {
    ensureSettings().then(function () {
      maybeOpenOnboarding(details);
    }).catch(function () {});
  });
  api.runtime.onStartup.addListener(function () { ensureSettings().catch(function () {}); });

  api.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName === "local" && changes[shared.STORAGE_KEY]) {
      updateBadge(changes[shared.STORAGE_KEY].newValue);
    }
  });

  api.runtime.onMessage.addListener(function (message, sender) {
    if (!shared.isAllowedExtensionMessage(message, [shared.MESSAGE.GET_SETTINGS, shared.MESSAGE.SAVE_SETTINGS])) {
      return undefined;
    }
    if (!shared.isSafeExtensionPageSender(sender, extensionBase, { popup: true, options: true })) {
      return undefined;
    }
    if (message.type === shared.MESSAGE.GET_SETTINGS) return settingsWrites.then(getSettings);
    if (message.type === shared.MESSAGE.SAVE_SETTINGS) return saveSettings(message.patch);
    return undefined;
  });

  ensureSettings().catch(function () {});
}).call(typeof globalThis !== "undefined" ? globalThis : this);
