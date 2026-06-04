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
