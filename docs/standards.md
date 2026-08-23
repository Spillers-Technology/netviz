# Company standards status

Reconciled 2026-08-25 against `corporate-strategy/standards/STD-001` through
`STD-008` and this branch. Re-verify these claims against the live repo when the
standards or implementation changes.

| Standard | Status | Evidence / reason |
|---|---|---|
| STD-001 adversarial review | not-yet | The company standard has not yet been proposed for netviz and no repo-local routed-review log exists. |
| STD-002 PR template | adopted | `.github/PULL_REQUEST_TEMPLATE.md` has the required problem, checks, evidence, and synthetic-network-data clauses. |
| STD-003 doc freshness | adopted (manual) | `CHANGELOG.md` is now explicitly the sole release-notes source; historical per-version notes are clearly retired after v0.2.0. |
| STD-004 identity architecture | adopted (partial) | netviz consumes OIDC for SSO; its scanning role does not require the full local-account/PAT reference shape. |
| STD-005 agent surface | not-yet | No MCP or equivalent agent-facing control surface is shipped. |
| STD-006 secret handling | adopted by scope | Probe/API credentials are injected by config or environment and are never committed in deployment manifests; no deployment secret is stored in this repo. |
| STD-007 repo metadata | adopted (partial) | LICENSE and CHANGELOG exist and the release-notes convention is now explicit; company-wide rights-holder and AI-attribution conventions remain undecided. |
| STD-008 UI capture validation | not-yet | A desktop documentation capture script exists, but it has no overflow/error assertion and is not run in CI. |
