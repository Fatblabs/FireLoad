# FireLoad 0.1.7

- Fixed prefetch queues exceeding mode budgets.
- Prioritize hovered or activated links over queued viewport predictions.
- Cancel pending hover/focus work when intent ends, and discard stale work when privacy settings change or a tab becomes hidden.
- Resume prediction when a tab becomes visible or a page returns from the back/forward cache.
- Reduced unnecessary scans triggered by FireLoad's own hints and text-only page updates.
- Fixed concurrent settings saves and stale UI responses.
- Preserve blocked-host edits while other options are changed.
- Hardened mode validation, encoded sensitive URLs, and blocked-host normalization.
- Added regression coverage and reproducible XPI/source archives.
- Added Firefox network and cache-reuse tests to the release workflow.
- Clarified that the activity counter shows requested hints, not confirmed cache entries.
