# Reviewer Notes

FireLoad improves perceived navigation speed by injecting browser-native speculative loading hints into pages:

- `dns-prefetch`
- `preconnect`
- `prefetch` with `as="document"`

Important privacy behavior: these hints can make Firefox contact linked sites before the user clicks a link. Blazing Fast mode uses larger budgets and may increase early requests. Cross-site document prefetching is disabled by default and can only be enabled from Options.

FireLoad does not collect analytics or telemetry. It has no FireLoad server and no remote code. Settings are stored locally with `browser.storage.local`.

The extension uses the `storage` permission plus explicit `http://*/*` and `https://*/*` host permissions/content-script matches. These are required for universal page support in Firefox. FireLoad avoids `<all_urls>`, and the background script does not fetch or inspect websites.

Build and validation:

```sh
npm run check
npm test
npx --yes web-ext@10.3.0 lint --source-dir .
npm run build
```

The resulting package is:

```text
dist/fireload.xpi
```

Node.js 22.16.0 or newer and Info-ZIP zip/unzip are required for the local gates. No install is needed for the unit tests or build. `npm run source:zip` creates `dist/fireload-source.zip`; `npm test` verifies that extracting that archive and building it reproduces the exact XPI.

The existing AMO listing uses `fireload@local.dev`. This ID is intentionally retained for update compatibility.

The release workflow also runs `npm run test:firefox` on Linux with Firefox, geckodriver, and the isolated test-only dependency selenium-webdriver 4.44.0. See README.md for local setup and executable overrides. These tools are not included in the add-on.
