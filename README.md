# FireLoad

FireLoad is a Firefox WebExtension that improves perceived navigation speed by warming likely next pages before the click lands. It uses browser-native speculative loading primitives instead of remote services or heavy frameworks.

## Modes

- Efficiency: hover and focus document prefetching with tight budgets, 1 document in flight.
- Balanced: visible-link prediction plus intent signals, cautious cross-site prefetching, 2 documents in flight.
- Blazing Fast: broad viewport prediction, cross-site document prefetching, 6 documents in flight and larger queues.

## Strategy

FireLoad borrows the practical parts of very fast catalog sites:

- Keep the extension itself tiny and dependency free.
- Run early at `document_start`.
- Warm DNS and TCP/TLS with `dns-prefetch` and `preconnect`.
- Prefetch likely HTML documents with `<link rel="prefetch" as="document">`.
- Warm links before native new-tab and new-window flows by reacting to right-click context menus, middle-clicks, modifier clicks, and keyboard activation.
- Use bounded queues so aggressive mode is fast without becoming unbounded.
- Skip downloads, static assets, same-document links, sensitive paths, and blocked hosts.

## Load in Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Select `Load Temporary Add-on`.
3. Choose this repository's `manifest.json`.
4. Use the toolbar popup to switch modes.

## Reviewer Build Instructions

These instructions reproduce the submitted add-on package from source.

### Build Environment

- Operating system: Linux, macOS, or another POSIX-compatible shell environment. Mozilla's default reviewer environment, Ubuntu 24.04.4 LTS on ARM64, is supported.
- Required programs:
  - Node.js `22.16.0` or newer. The add-on was tested with Node.js `22.16.0`; Mozilla's default Node.js `24.14.0` is expected to work.
  - npm `10.9.2` or newer. The add-on was tested with npm `10.9.2`; Mozilla's default npm `11.9.0` is expected to work.
  - Info-ZIP `zip` `3.0` or compatible.
- No `npm install` is required to build the extension package. The packaged extension has no bundled third-party dependencies and no remote code dependencies.

On Ubuntu, if `zip` is not installed:

```sh
sudo apt-get update
sudo apt-get install -y zip
```

### Build Steps

From the root of the source submission:

```sh
npm run check
npm test
npm run build
```

The build script is [tools/build-addon.mjs](tools/build-addon.mjs). It creates:

```text
dist/fireload.xpi
```

The submitted `.xpi` is built from these source paths only:

```text
manifest.json
src/
popup/
options/
icons/
README.md
```

### Optional Lint

Mozilla's web-ext linter can be run with:

```sh
npx --yes web-ext@10.3.0 lint --source-dir .
```

### Optional Source Archive

To create the source archive for AMO review:

```sh
npm run source:zip
```

This creates:

```text
dist/fireload-source.zip
```

## Real Browser Prefetch Test

The integration runner in `tools/test-firefox-prefetch.cjs` launches Firefox, installs the packaged extension, starts a local HTTP server, hovers a link, and verifies that the server receives a `sec-purpose: prefetch` request before navigation.

It expects Selenium and geckodriver to be available to Node. One clean way to run it without adding dependencies to this repo:

```sh
TMP_AUTOMATION_DIR=$(mktemp -d /tmp/fireload-automation.XXXXXX)
npm install --prefix "$TMP_AUTOMATION_DIR" selenium-webdriver@4.44.0 geckodriver@6.1.0
NODE_PATH="$TMP_AUTOMATION_DIR/node_modules" node tools/test-firefox-prefetch.cjs
```

## Safety Notes

Speculative loading can increase bandwidth and may cause servers to see requests before a user clicks. FireLoad keeps a side-effect guard on by default and skips paths containing terms such as checkout, logout, payment, delete, token, session, and unsubscribe. Blazing Fast mode is intentionally aggressive, so keep the blocked-host list current for private apps or fragile internal tools.

Firefox and sites may ignore, throttle, or block speculative hints. FireLoad improves the odds of a warm cache and warm connection, but it cannot override server cache headers, site CSP, login boundaries, or browser privacy protections.

FireLoad does not collect analytics, send telemetry, or transmit data to a FireLoad service. It stores extension settings locally in Firefox. Its core function can still cause Firefox to make early requests to linked websites through browser-native prefetching.
