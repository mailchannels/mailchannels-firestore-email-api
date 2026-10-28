# Dependency review

Checked 2026-10-26 with Node 22.23.3 and npm 10.9.9 (`node:22.23.3-bookworm`).

## Production tree

`npm audit --omit=dev` finds nothing. The lock was refreshed within the existing
manifest ranges only, with no overrides or downgrades:

| Package | Before | After | Why |
| --- | --- | --- | --- |
| `@google-cloud/storage` (via `firebase-admin`) | 8.2.0 | 8.4.0 | Moves Storage to `gaxios` 7 / `google-auth-library` 11, removing the `uuid` advisory (GHSA-w5hq-g745-h8pq) from the production tree |
| `body-parser` (via `firebase-functions` → `express` 5) | 2.3.0 | 2.4.0 | GHSA-27r3-jxmh-p828 (high, denial of service via trailing bytes after a compressed body) |

`npm run test:package` also audits the dependencies a fresh consumer resolves from
the packed tarball, because a consumer's install is not bound by this lock.

## Development tree

`npm audit` still reports 14 findings (10 high, 4 moderate), all in development
dependencies that are not part of the published package:

- `firebase-tools` 15.32.1 (pinned for the emulator): `basic-ftp`, `get-uri`,
  `pac-proxy-agent`, `proxy-agent`, `@google-cloud/pubsub`, `@opentelemetry/core`,
  `gaxios` 6 and `uuid`. npm's only suggested fix is a downgrade to 14.23.0.
- `@firebase/rules-unit-testing` 5 / `firebase` 12 (emulator tests): `@grpc/grpc-js`,
  `@firebase/firestore`, `@firebase/firestore-compat`. npm's only suggested fix is a
  downgrade to `firebase` 9.14.0.

In-range updates for `fast-uri`, `ip-address`, `undici` and `zod` were applied in
the same lock refresh. The remaining findings are accepted for local and CI
tooling only. Revisit when `firebase-tools` or `firebase` publish fixed releases.

## Rollback

Revert the commit that changed `package-lock.json` and run `npm ci --ignore-scripts`.
No data, queue or receipt format changes are involved.
