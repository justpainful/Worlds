# Local identity integration fixture

`mailbox.cjs` listens only on 127.0.0.1 and accepts email for synthetic
`worlds-fixture-<UUID>@example.test` addresses. It keeps one-time codes in
memory, returns each once, and does not log message contents. It is test code,
not an email service or part of the application.

The gated `LiveIdentityServiceTests` requires a disposable local instance of
`services/identity`, an isolated D1 database with all migrations, a freshly
generated signing key, and `EMAIL_WEBHOOK_URL` pointing to this mailbox. Set
`WORLDS_REQUIRE_LIVE_IDENTITY=1`, `WORLDS_LIVE_IDENTITY_URL` and
`WORLDS_LIVE_MAILBOX_URL` to loopback HTTP endpoints for the test process.
Never use a deployed identity service, real email addresses or user credentials.
The test exercises email login, authenticated profile, signed token rotation and
remote logout. It does not prove Apple Keychain entitlements, passkeys, device
signing or production service configuration.
