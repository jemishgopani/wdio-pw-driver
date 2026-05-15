# Security policy

## Supported versions

`wdio-pw-driver` is pre-1.0; only the latest published version receives
security fixes. Once we cut `1.0.0`, the latest two minor versions of the
current major will be supported in line with the policy in the README.

## Reporting a vulnerability

**Do not file a public GitHub issue.** Email `jemishgopani2@gmail.com`
with subject `[wdio-pw-driver:security] <short description>`. Include:

- Version of `wdio-pw-driver` you're running
- A minimal reproduction (smallest WDIO config + spec that demonstrates the issue)
- The impact you observed (info disclosure, RCE, data exfiltration, etc.)

You can expect:

- Acknowledgement within **3 business days**
- A triage decision (fix planned / accepted as known-issue / not a vulnerability) within **7 business days**
- Coordinated disclosure timeline agreed before any public mention

If a vulnerability touches `playwright-core` rather than driver code, please
report it upstream to the Microsoft Playwright team — `wdio-pw-driver` only
adds the WebDriverIO bridge, the engine itself is theirs.

## Scope

In scope:

- The `wdio-pw-driver` npm package (`src/`)
- The bundled `wdioPW` CLI (`bin/`)
- The `PWService` launcher service
- Documentation that, if followed, would put a user in an insecure state

Out of scope:

- Vulnerabilities in `playwright-core` (report upstream)
- Vulnerabilities in WebdriverIO itself (report to OpenJS)
- The Docusaurus documentation site infrastructure
- Test-only code under `tests/`

## Hardening guidance for users

- Pin `playwright-core` to a known-good version in your `package.json`.
- Don't run untrusted spec files — `executeScript` and `pwRoute` have full page
  access and can exfiltrate cookies / storage state.
- When using `pwSaveStorage`, treat the resulting JSON as a credential.
  Don't commit it; don't log it; rotate if disclosed.
- Disable `wdio:pwOptions.trace` for production-data tests — trace zips
  contain DOM snapshots that may include sensitive fields.
