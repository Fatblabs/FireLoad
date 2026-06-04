# AMO Listing Copy

## Summary

FireLoad makes Firefox feel faster by warming likely next pages before you click.

## Description

FireLoad uses Firefox's native speculative loading hints to warm likely next pages. It can prepare DNS, connections, and selected documents so normal navigation feels quicker.

Modes:

- Efficiency: smaller budgets and one document in flight.
- Balanced: everyday default for visible links and clear intent.
- Blazing Fast: larger same-site budgets for pages where speed matters most.

Privacy and bandwidth note: prefetching can make Firefox contact linked sites before you click. Blazing Fast increases the chance of early requests. Cross-site document prefetching is off by default and must be enabled in Options.

FireLoad has guardrails for sensitive paths such as checkout, payment, logout, token, and session URLs. You can also block hosts that FireLoad should leave alone.

FireLoad does not collect analytics, send telemetry, use remote code, or transmit data to a FireLoad service.
