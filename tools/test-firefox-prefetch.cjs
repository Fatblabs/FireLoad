const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { Builder, By, until } = require("selenium-webdriver");
const firefox = require("selenium-webdriver/firefox");
const geckodriver = require("geckodriver");

const root = path.resolve(__dirname, "..");
const xpiPath = path.join(root, "dist", "fireload.xpi");
const firefoxBinary = "/Applications/Firefox.app/Contents/MacOS/firefox";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    function tick() {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error(`Timed out waiting for ${label}`));
        return;
      }
      setTimeout(tick, 50);
    }
    tick();
  });
}

function startServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      at: Date.now()
    });

    if (req.url === "/" || req.url.startsWith("/?")) {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=60"
      });
      res.end(`<!doctype html>
<html>
  <head><title>FireLoad Integration</title></head>
  <body>
    <div id="mount"></div>
    <script>window.__loadedAt = Date.now();</script>
  </body>
</html>`);
      return;
    }

    if (
      req.url === "/target" ||
      req.url.startsWith("/target?") ||
      req.url === "/cross-target" ||
      req.url.startsWith("/cross-target?")
    ) {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=60"
      });
      res.end(`<!doctype html><html><body><h1>Target</h1></body></html>`);
      return;
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        requests,
        baseUrl: `http://127.0.0.1:${server.address().port}`
      });
    });
  });
}

function countRequests(requests, prefix) {
  return requests.filter((request) => request.url.startsWith(prefix)).length;
}

function findRequests(requests, prefix) {
  return requests.filter((request) => request.url.startsWith(prefix));
}

async function injectedHints(driver) {
  return driver.executeScript(`
    return Array.from(document.querySelectorAll('link[data-fireload]')).map((link) => ({
      rel: link.rel,
      as: link.as || null,
      href: link.href,
      reason: link.dataset.fireload || null
    }));
  `);
}

async function addLink(driver, id, href, text) {
  await driver.executeScript(`
    const existing = document.getElementById(arguments[0]);
    if (existing) existing.remove();
    const link = document.createElement('a');
    link.id = arguments[0];
    link.href = arguments[1];
    link.textContent = arguments[2];
    link.style.display = 'inline-block';
    link.style.margin = '120px';
    link.style.padding = '24px';
    link.style.fontSize = '18px';
    document.getElementById('mount').appendChild(link);
  `, id, href, text);
  return driver.wait(until.elementLocated(By.id(id)), 5000);
}

async function main() {
  assert.ok(fs.existsSync(xpiPath), `Missing ${xpiPath}; run npm run zip first.`);
  assert.ok(fs.existsSync(firefoxBinary), `Missing Firefox binary at ${firefoxBinary}`);

  const primary = await startServer();
  const crossOrigin = await startServer();
  const { server, requests, baseUrl } = primary;
  let driver;
  let geckoProcess;

  try {
    geckoProcess = await geckodriver.start({});
    const options = new firefox.Options()
      .setBinary(firefoxBinary)
      .addArguments("-headless")
      .setPreference("extensions.autoDisableScopes", 0)
      .setPreference("extensions.enabledScopes", 15)
      .setPreference("browser.cache.disk.enable", true)
      .setPreference("browser.cache.memory.enable", true)
      .setPreference("network.predictor.enabled", true)
      .setPreference("network.dns.disablePrefetch", false);

    driver = await new Builder()
      .forBrowser("firefox")
      .setFirefoxOptions(options)
      .build();

    await driver.installAddon(xpiPath, true);
    await driver.get(baseUrl + "/");
    await sleep(1500);

    const link = await addLink(driver, "target-link", "/target?case=hover", "Hover target");
    const beforeHoverTargetCount = countRequests(requests, "/target?case=hover");

    await driver.actions({ async: true }).move({ origin: link }).perform();

    if (beforeHoverTargetCount === 0) {
      try {
        await waitFor(
          () => countRequests(requests, "/target?case=hover") > beforeHoverTargetCount,
          5000,
          "hover prefetch request to /target"
        );
      } catch (error) {
        const hints = await injectedHints(driver);
        const headHtml = await driver.executeScript("return document.head.innerHTML;");
        console.error(JSON.stringify({
          requests,
          injectedHints: hints,
          headHtml
        }, null, 2));
        throw error;
      }
    }

    let hints = await injectedHints(driver);

    if (!hints.some((hint) => hint.href === baseUrl + "/target?case=hover" && hint.reason === "hover")) {
      const headHtml = await driver.executeScript("return document.head.innerHTML;");
      console.error(JSON.stringify({
        requests,
        injectedHints: hints,
        headHtml
      }, null, 2));
      throw new Error("FireLoad did not inject a hover /target prefetch hint.");
    }

    const targetRequests = findRequests(requests, "/target?case=hover");
    const hoverRequest = targetRequests[targetRequests.length - 1];
    assert.equal(hoverRequest.method, "GET");
    assert.equal(hoverRequest.headers["sec-purpose"], "prefetch");

    await sleep(250);
    const currentUrl = await driver.getCurrentUrl();
    assert.equal(currentUrl, baseUrl + "/");

    const sensitiveBefore = countRequests(requests, "/checkout/payment");
    const sensitiveLink = await addLink(driver, "sensitive-link", "/checkout/payment?case=sensitive", "Sensitive target");
    await driver.actions({ async: true }).move({ origin: sensitiveLink }).perform();
    await driver.executeScript(`
      arguments[0].dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 2
      }));
    `, sensitiveLink);
    await sleep(900);
    assert.equal(countRequests(requests, "/checkout/payment"), sensitiveBefore);

    const crossTargetPath = "/cross-target?case=contextmenu";
    const crossBefore = countRequests(crossOrigin.requests, crossTargetPath);
    const crossLink = await addLink(driver, "cross-link", crossOrigin.baseUrl + crossTargetPath, "Cross origin target");
    await driver.executeScript(`
      arguments[0].dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 2
      }));
    `, crossLink);
    await waitFor(
      () => countRequests(crossOrigin.requests, crossTargetPath) > crossBefore,
      5000,
      "context-menu prefetch request to cross-origin target"
    );
    hints = await injectedHints(driver);
    const crossRequests = findRequests(crossOrigin.requests, crossTargetPath);
    const contextMenuRequest = crossRequests[crossRequests.length - 1];
    assert.equal(contextMenuRequest.headers["sec-purpose"], "prefetch");

    console.log(JSON.stringify({
      ok: true,
      baseUrl,
      crossOriginBaseUrl: crossOrigin.baseUrl,
      hoverTargetRequestCount: targetRequests.length,
      preloadedBeforeHover: beforeHoverTargetCount > 0,
      sensitiveRequestCount: countRequests(requests, "/checkout/payment"),
      crossOriginPrefetchCount: crossRequests.length,
      injectedHints: hints,
      hoverRequestHeaders: {
        purpose: hoverRequest.headers.purpose || null,
        secPurpose: hoverRequest.headers["sec-purpose"] || null,
        accept: hoverRequest.headers.accept || null
      },
      contextMenuRequestHeaders: {
        purpose: contextMenuRequest.headers.purpose || null,
        secPurpose: contextMenuRequest.headers["sec-purpose"] || null,
        accept: contextMenuRequest.headers.accept || null
      },
      currentUrl
    }, null, 2));
  } finally {
    if (driver) await driver.quit().catch(() => {});
    if (geckoProcess && geckoProcess.kill) geckoProcess.kill();
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => crossOrigin.server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
