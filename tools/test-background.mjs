import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharedSource = fs.readFileSync(path.join(root, "src/shared.js"), "utf8");
const backgroundSource = fs.readFileSync(path.join(root, "src/background.js"), "utf8");

async function settle() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function createHarness() {
  const runtimeListeners = [];
  const storageListeners = [];
  const badges = [];
  let storedSettings;

  const browser = {
    action: {
      setBadgeText(value) {
        badges.push({ text: value.text });
      },
      setBadgeBackgroundColor(value) {
        badges.push({ color: value.color });
      }
    },
    runtime: {
      id: "fireload@test",
      getURL(file = "") {
        return `moz-extension://fireload-test/${file}`;
      },
      onInstalled: {
        addListener() {}
      },
      onStartup: {
        addListener() {}
      },
      onMessage: {
        addListener(listener) {
          runtimeListeners.push(listener);
        }
      }
    },
    storage: {
      local: {
        get() {
          return Promise.resolve({ fireloadSettings: storedSettings });
        },
        set(value) {
          storedSettings = value.fireloadSettings;
          return Promise.resolve();
        }
      },
      onChanged: {
        addListener(listener) {
          storageListeners.push(listener);
        }
      }
    }
  };

  const context = vm.createContext({
    browser,
    console,
    globalThis: null,
    JSON,
    Promise
  });
  context.globalThis = context;

  vm.runInContext(sharedSource, context, { filename: "src/shared.js" });
  vm.runInContext(backgroundSource, context, { filename: "src/background.js" });

  return {
    badges,
    context,
    get storedSettings() {
      return storedSettings;
    },
    async ready() {
      await settle();
    },
    send(message, sender) {
      assert.equal(runtimeListeners.length, 1);
      return runtimeListeners[0](message, sender);
    }
  };
}

const allowedPopupSender = {
  id: "fireload@test",
  url: "moz-extension://fireload-test/popup/popup.html"
};
const allowedOptionsSender = {
  id: "fireload@test",
  url: "moz-extension://fireload-test/options/options.html"
};
const deniedPageSender = {
  id: "fireload@test",
  url: "https://site.test/page"
};
const deniedOtherExtensionSender = {
  id: "other-extension@test",
  url: "moz-extension://fireload-test/popup/popup.html"
};

{
  const harness = createHarness();
  await harness.ready();
  const settings = await harness.send({ type: harness.context.FireLoadShared.MESSAGE.GET_SETTINGS }, allowedPopupSender);
  assert.equal(settings.mode, "balanced");
  assert.equal(settings.enabled, true);
}

{
  const harness = createHarness();
  await harness.ready();
  const denied = harness.send(
    { type: harness.context.FireLoadShared.MESSAGE.SAVE_SETTINGS, patch: { mode: "blazing" } },
    deniedPageSender
  );
  assert.equal(denied, undefined);
  assert.equal(harness.storedSettings.mode, "balanced");
}

{
  const harness = createHarness();
  await harness.ready();
  const denied = harness.send(
    { type: harness.context.FireLoadShared.MESSAGE.SAVE_SETTINGS, patch: { mode: "blazing" } },
    deniedOtherExtensionSender
  );
  assert.equal(denied, undefined);
  assert.equal(harness.storedSettings.mode, "balanced");
}

{
  const harness = createHarness();
  await harness.ready();
  const patch = JSON.parse('{"__proto__":{"polluted":true},"mode":"blazing","enabled":false}');
  const next = await harness.send(
    { type: harness.context.FireLoadShared.MESSAGE.SAVE_SETTINGS, patch },
    allowedOptionsSender
  );
  assert.equal(next.mode, "blazing");
  assert.equal(next.enabled, false);
  assert.equal(harness.storedSettings.mode, "blazing");
  assert.equal({}.polluted, undefined);
}

console.log("Background message security tests passed.");
