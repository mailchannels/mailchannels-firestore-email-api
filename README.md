# MailChannels Firestore Email API function kit

Unreleased development candidate. A trusted server writes an email document to a
Firestore outbox; a second-generation Firebase function makes one MailChannels
Email API attempt after creating a durable receipt. This is an alternative to the
closed Firebase Extensions Hub publisher route, not a Hub listing or an official
replacement for Google's SMTP extension.

Support: dev@mailchannels.com. Node 22+, Firebase Functions 7.4+, Admin SDK 14.5+.

## Document and configuration

The default collection is `mailchannelsOutbox`. Use an immutable, deterministic
business operation ID as the document ID. A trusted producer creates, never updates:

```json
{
  "to": ["recipient@example.com"],
  "subject": "Your report",
  "text": "Your report is ready.",
  "html": "<p>Your report is ready.</p>"
}
```

Provide text, HTML or both. This candidate accepts up to 50 recipients and a
256 KiB serialized payload. Unknown fields, including sender overrides, attachments,
Cc/Bcc, templates and endpoint URLs, are rejected. This is a restricted outbox
schema, not a complete proxy for every Email API field. The server producer owns
HTML safety, recipient authorization, consent, templates and business validation.

| Parameter | Purpose |
| --- | --- |
| `MAILCHANNELS_SENDER` | Fixed authorized sender email, required |
| `MAILCHANNELS_API_KEY` | Secret Manager secret, bound only to this function |
| `MAILCHANNELS_QUEUE` | Top-level outbox collection, default `mailchannelsOutbox` |
| `MAILCHANNELS_RECEIPTS` | Top-level receipt collection, default `mailchannelsReceipts` |
| `MAILCHANNELS_INSTANCE` | Receipt namespace, default `default` |

Collection and instance names must begin with an ASCII letter, contain only
letters, digits, underscore or hyphen, and be at most 64 characters. Queue and
receipt collections must differ. Each deployed instance must use its own queue
and receipt namespace. Two instances watching the same queue can send twice;
instance names deliberately isolate receipts and are not a cross-instance dedupe key.
Do not rename a receipt namespace during an upgrade or delete its records to retry.

## Durable outcomes and operator procedure

Receipts live at `mailchannelsReceipts/default/operations/<operation ID>` by
default. They contain a version, payload SHA-256, timestamps and state/status;
no key, recipient or body. Hashes may still be sensitive for guessable messages.
The outbox contains message content and needs a company retention/access policy.

A Firestore transaction checks the current document's creation timestamp and
normalized payload, then creates `claimed`. Only its successful caller sends;
the HTTP attempt is outside the transaction. Duplicate or conflicting events do
not send. Missing credentials and invalid documents do not consume a claim.
The current snapshot check does not prevent a trusted producer mutating a document
after claim; producers must enforce immutability and use deterministic IDs.

- `accepted`: HTTP 202, API acceptance only; not inbox delivery.
- `rejected`: HTTP 4xx except 408, including 429. No automatic retry.
- `unknown`: timeout, connection failure, 408, 5xx, redirects or unexpected status.
- `claimed` without a terminal result: crash or failed receipt write may have
  happened before or after provider acceptance. Never automatically reclaim it.

The function does not enable event retries, follow redirects or retry HTTP. It
uses a fixed HTTPS endpoint, normal certificate validation and a 15-second total
HTTP deadline. The response body is discarded. Event delivery may still repeat;
receipts protect this namespace, not provider-wide exactly-once delivery.

Before enabling traffic, assign an operator and alerts for fixed error diagnostics,
invalid/unconfigured/conflict results and old `claimed`/`unknown` receipts. No
monitoring service or automatic reconciler is shipped. Stop producers during an
incident; inspect the queue, receipt and provider activity using approved access.
If acceptance remains uncertain, hold the operation. A confirmed rejection may be
reissued only by an explicit business decision using a new operation ID and an
independent audit trail linking the old operation. Keep dedupe receipts/tombstones
for as long as any source/event/backup can replay. There is no TTL or deletion job.
Restoring a queue without its receipts can resend messages. Back up both and test
recovery before production use. Never log raw provider errors or key values.

## Company setup and eventual installation

1. Assign a company Firebase operator and npm release maintainer. Firebase enablement, access,
   Firestore database/location and billing have not been verified. Use a company-owned
   isolated test project before modifying shared resources. No legacy Extensions
   publisher registration is needed. Review Cloud billing/Blaze costs and budgets.
2. Enable Firebase, the default Firestore database and the APIs required by v2
   Cloud Functions (including Cloud Run, Eventarc, Cloud Build, Artifact Registry
   and Secret Manager). Use a dedicated runtime service account. It needs Firestore
   data access and access only to the bound API secret. Firestore IAM access is
   broader than one collection; use project/database isolation as needed. Separate
   deployment privileges from runtime privileges, and review Eventarc identities.
   This package does not provision IAM or claim it has verified least privilege.
3. Review `firestore.rules` and merge collection denials into the company's rules.
   Rules are not installed by npm. An overlapping `allow` rule can still grant
   access. Admin SDK producers bypass rules: restrict their IAM and code paths.
   Never expose arbitrary outbox creation as a client feature.
4. Have the npm maintainer review the source, package name and tests, then publish
   a prerelease under company control. No package or publisher has been registered
   by this work. Keep publishing credentials out of this repository and chat.
5. With Firebase CLI 15.32.1, check `functions:kits:install --help`. The observed
   current flag is `--package`, not the older PR's `--npm_package`. The command is
   gated by the `kits` experiment and requires authentication. In a reviewed local
   Firebase project, enable the experiment and install the approved version:

   ```sh
   firebase experiments:enable kits
   firebase functions:kits:install --package @mailchannels/firestore-email-api@APPROVED_VERSION
   ```

   This command has not been validated with an authenticated company project.
   Inspect generated codebase/instance configuration, runtime, parameters, region,
   service account and deployment plan. For manual integration, re-export
   `sendQueuedEmail` from this package in a dedicated functions codebase.
6. Set the API key with the CLI's `functions:secrets:set MAILCHANNELS_API_KEY`
   prompt; never put it in Firestore or committed dotenv files. Configure the fixed
   authorized sender and collection/instance values. Review rotation/redeployment
   behavior before production. Deploy only the reviewed codebase after company
   approval of costs/IAM. Use mocked or separately authorized provider validation;
   no live email is authorized by the local test procedure.
7. Validate cloud trigger delivery, duplicate/reordered events, IAM and security
   rules, crash/reconciliation/backup/retention, upgrades, multiple isolated
   instances and operating alerts. Publish a stable npm release, public source and
   a MailChannels Firebase guide only after release review. Verify clean install
   from npm and public discovery. None of these is a Firebase Hub listing.

## Local validation

Use Node 22 and Java 21 with npm. `npm ci --ignore-scripts`, then `npm test`.
Download the official emulator with `npx firebase setup:emulators:firestore`, then
run `node scripts/emulator.cjs`. Ports 15001 and 18080 must be available. The runner
uses the demo project, synthetic fixtures, a mocked provider transport and the
real Firestore/Functions emulators. It creates disposable local data only.

Run `npm run test:package` for a fresh tarball consumer/discovery check.

Release dependency gate: the inspected production dependency tree has two moderate
audit findings (uuid via gaxios in firebase-admin's Cloud Storage dependency). The
full development tree has 16 findings (12 high, four moderate) after compatible
updates. No forced downgrade/override was applied. Resolve or formally review
these before publication; the local lock does not control a consumer's dependencies.

The 13 unit tests exercise schema/configuration and mocked HTTP status, deadline
and no-retry behavior. The emulator suite has 68 assertions covering real transactions/security
rules and the exported v2 trigger. It also SIGKILLs isolated workers after claim,
both before a mock attempt and after mock acceptance; subsequent replays make
zero attempts and leave the claim for operator review. This is local process death
with simulated acceptance, not Cloud Run termination or real provider acceptance.

For actual TLS validation, install Python cryptography 45.0.3 in a test environment
and run `python scripts/tls.py` with Docker available. Nine scenarios use disposable
certificates and the unchanged production HTTPS endpoint mapped to Docker loopback
with `--network none`: valid/invalid certificates, redirect, 429, 503, streaming
error response and a real 15-second pre-header deadline. They check attempt counts
and peer socket cleanup. The runner destroys its containers and temporary keys.

These checks do not prove production IAM, deployment, provider delivery, company
reconciliation/backup/retention, Cloud Run crash recovery or end-to-end kit
installation. Those remain release gates.

References:
- https://firebase.google.com/docs/extensions/publishers/migrate
- https://firebase.google.com/docs/functions/config-env
- https://firebase.google.com/docs/emulator-suite/connect_functions
- https://firebase.google.com/docs/firestore/security/rules-conditions
