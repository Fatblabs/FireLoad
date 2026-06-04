# Permission Justification

## `storage`

FireLoad uses `browser.storage.local` to store local user settings:

- Enabled/disabled state.
- Selected mode.
- Guardrails.
- Blocked hosts.
- Live popup stats preference.
- Cross-site document prefetch opt-in.

No settings are sent to a FireLoad server.

## HTTP/HTTPS Host Permissions and Content Script Matches

FireLoad requests explicit HTTP and HTTPS host permissions and runs content scripts on:

```json
["http://*/*", "https://*/*"]
```

This is required because FireLoad is a universal page-warming extension. The content script observes links on ordinary web pages and injects browser-native `<link>` hints into the current page. It does not run on `file:`, `about:`, `moz-extension:`, `data:`, or other non-web schemes.

FireLoad intentionally avoids `<all_urls>`.

The background script does not fetch or inspect websites. Page access is used by the content script so it can see links and add speculative loading hints to the current page.
