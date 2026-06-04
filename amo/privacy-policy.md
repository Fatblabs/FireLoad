# FireLoad Privacy Policy

FireLoad does not collect, sell, transmit, or store personal data on a FireLoad server. FireLoad does not use analytics, telemetry, remote code, advertising identifiers, or a remote service.

FireLoad stores settings locally in Firefox extension storage, including:

- Whether FireLoad is enabled.
- The selected mode.
- Guardrail settings.
- The blocked-host list.
- Whether live popup stats are enabled.
- Whether cross-site document prefetching is enabled.

FireLoad's core feature can still affect network privacy. It asks Firefox to warm likely next pages with browser-native hints such as DNS prefetch, preconnect, and document prefetch. This can make Firefox contact linked sites before the user clicks a link. Blazing Fast mode uses larger budgets and can increase the chance of early requests. Cross-site document prefetching is disabled by default and must be explicitly enabled in Options.

FireLoad skips sensitive paths by default, including checkout, payment, logout, delete, token, session, and similar URLs. Users can also add blocked hosts for sites that should never be warmed.
