# Security Review

FireLoad is a small, dependency-free WebExtension. The package contains readable JavaScript, HTML, CSS, and SVG files. It does not bundle third-party runtime libraries, minified code, obfuscated code, remote code, or generated extension code.

## Attack Surface Controls

- Manifest V3.
- Host permissions and content scripts are limited to `http://*/*` and `https://*/*`; FireLoad avoids `<all_urls>`.
- `all_frames` is `false`.
- Strict extension-page CSP:
  - `default-src 'self'`
  - `script-src 'self'`
  - `style-src 'self'`
  - `img-src 'self'`
  - `object-src 'none'`
  - `connect-src 'none'`
  - `base-uri 'none'`
  - `form-action 'none'`
  - `frame-ancestors 'none'`
- No `eval`, `Function`, remote scripts, `innerHTML`, `document.write`, or remote fetch calls in extension code.
- No `web_accessible_resources`.

## Message Handling

Background settings messages are accepted only from FireLoad's own popup and options pages. Content summary messages are accepted only from FireLoad's popup. Unknown message types and untrusted senders are ignored.

## Data Handling

Settings are normalized through explicit allow-listed fields. FireLoad does not merge arbitrary message payloads into settings objects.

Mode names must be own properties of the mode configuration, so inherited names such as `constructor` are rejected. Settings writes are serialized to prevent concurrent changes from overwriting each other. Content scripts wait for saved settings before starting work and stay inactive if the initial settings read fails.

## Prefetch Safety

FireLoad skips:

- Sensitive current pages.
- Sensitive link targets.
- Downloads.
- Static assets.
- Same-document links.
- Credentialed URLs.
- Non-HTTP(S) schemes.
- HTTPS-to-HTTP downgrade targets.
- User-configured blocked hosts.

Cross-site document prefetching is disabled by default and requires an explicit option.

Sensitive URL checks decode percent-encoded paths. Host blocking normalizes international hostnames, ports, and trailing dots. These remain heuristics, not a malware scanner or a guarantee that a URL has no side effects.

Pending queues, observers, and intent timers are cleared on activity-affecting settings changes and when the page is hidden or leaves the active lifecycle. Started browser requests may still complete. Total document budgets account for queued work, and mutation handling ignores FireLoad's own hints and text-only changes to avoid repeated scans.
