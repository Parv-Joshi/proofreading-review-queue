# Contributing

Keep changes generic, privacy-safe, and backward-compatible with the published Sheet schema. Do not commit real source text, correction exports, audit logs, IDs, URLs, credentials, names, email addresses, or deployment configuration.

Before opening a change:

1. Preserve Pending-by-default and zero-preaccept behavior.
2. Add tests for safety-critical behavior.
3. Run `npm test`.
4. Inspect the complete Git diff for private data.
5. Document schema or workflow changes.

Do not weaken source matching, overlap checks, live gates, backup creation, or audit logging to make a failing test pass.
