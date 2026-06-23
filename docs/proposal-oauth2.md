# Proposal: OAuth2 (XOAUTH2) authentication for Office 365 and Gmail

## Motivation

Microsoft permanently disabled **Basic Authentication** (username + password) for
IMAP/SMTP on Exchange Online / Microsoft 365 (`outlook.office365.com`,
`smtp.office365.com`). Google is deprecating it for `imap.gmail.com` /
`smtp.gmail.com` as well. Both now require **OAuth2 with the XOAUTH2 SASL
mechanism**. Without it, affected users cannot connect at all.

## Goals

- Add an `OAuth2` authentication option per account, alongside the existing
  `Basic` auth.
- Support two providers out of the box: **Microsoft** (Office 365 / Outlook) and
  **Google** (Gmail).
- Work fully inside the extension host (no external helper process), reusing the
  existing IMAP (`imapflow`) and SMTP (`nodemailer`) stacks, both of which
  support XOAUTH2.
- Persist only a long-lived **refresh token** in `SecretStorage`; obtain
  short-lived access tokens on demand and refresh transparently.

## Security principle: no secrets in the extension

Both providers are configured as **public desktop/native clients secured by
PKCE**. **No client secret** is ever embedded, configured, or stored — neither in
the source, the VSIX, nor user settings. Only a `client_id` is needed, which is a
*public* identifier (Microsoft and Google explicitly treat desktop/installed
clients as unable to keep secrets). For Google we use the "Desktop app" client
type and perform the token exchange with PKCE only (no `client_secret` in the
request). Refresh tokens are persisted in VS Code `SecretStorage`.

## Non-goals

- Shipping pre-registered client IDs. The extension cannot embed the author's
  registered `client_id`s. The user (or distributor) registers their own OAuth app
  and configures the (public) client ID via settings. See *Setup* below. Because
  client IDs are not secrets, they may optionally be shipped as package.json
  defaults if a maintainer registers shared apps.
- Migrating existing Basic accounts automatically (user switches auth type
  manually in account settings).

## Auth flow

Standard **Authorization Code flow with PKCE** for native/desktop apps
(RFC 8252), using a **loopback redirect**:

1. Extension starts a temporary `http` server on `127.0.0.1:<random port>`.
2. Builds the provider authorize URL (with `code_challenge`, `state`, scopes,
   `redirect_uri = http://<host>:<port>`) and opens it with
   `vscode.env.openExternal`.
3. User signs in + consents in the system browser; provider redirects to the
   loopback server with `?code=...&state=...`.
4. Extension exchanges the code at the token endpoint (sending `code_verifier`)
   for `access_token` + `refresh_token` (+ `id_token` to read the email address).
5. Refresh token is stored in `SecretStorage`; access token is cached in memory
   with its expiry.

On every IMAP/SMTP connect, `OAuthService.getAccessToken(account)` returns a
cached access token or silently refreshes it via the `refresh_token` grant.
Microsoft **rotates** refresh tokens, so the rotated token is persisted back to
`SecretStorage` automatically.

Loopback uses any port (both providers allow port-agnostic matching for loopback
redirect URIs). Host: `localhost` for Microsoft, `127.0.0.1` for Google
(matches each provider's recommended desktop redirect registration).

## Architecture changes

| Layer | Change |
| --- | --- |
| `types/account.ts` | `authType?: 'basic' \| 'oauth2'`, `oauthProvider?: 'microsoft' \| 'google'` |
| `services/oauthService.ts` (new) | Singleton. Microsoft via `@azure/msal-node` (`PublicClientApplication`, SecretStorage-backed cache plugin, silent refresh). Google via hand-rolled Authorization Code + PKCE flow with loopback redirect; refresh token in `SecretStorage`. Access-token cache, email extraction |
| `services/imapService.ts` | `connect` / `testConnection` use `auth: { user, accessToken }` when `authType === 'oauth2'` |
| `services/smtpService.ts` | `sendMail` / `testConnection` use nodemailer `auth: { type: 'OAuth2', user, accessToken }` |
| `services/accountManager.ts` | Deletes the OAuth refresh token on `removeAccount` |
| `panels/accountSettingsPanel.ts` | Pre-assigns an id for new accounts; handles `oauthSignIn`; passes auth type/provider to tests |
| `panels/views/accountSettings/*` | Auth-type selector, provider dropdown, "Sign in" button, autofill of known host/port presets |
| `package.json` | OAuth client-id / tenant / secret settings |

Token storage uses dedicated secret keys, independent of the Basic-auth password
slots: `mailClient.oauthRefresh.<accountId>` (Google refresh token) and
`mailClient.msalCache.<accountId>` (Microsoft MSAL token cache).

## Settings (package.json)

- `mailClient.oauth.microsoftClientId` – Azure AD application (client) ID.
- `mailClient.oauth.microsoftTenant` – tenant (`common`, `organizations`,
  `consumers`, or a tenant ID). Default `common`.
- `mailClient.oauth.googleClientId` – Google Cloud OAuth client ID (Desktop app).
  No client secret setting exists – the Google token exchange uses PKCE only.

## Provider endpoints & scopes

**Microsoft** (`{tenant}` from settings) — handled by `@azure/msal-node`
- Authority: `https://login.microsoftonline.com/{tenant}`
- Scopes: `openid profile offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send`
- Public client (no secret), PKCE. MSAL manages the token cache (serialized into
  `SecretStorage` per account) and silent refresh.

**Google**
- Authorize: `https://accounts.google.com/o/oauth2/v2/auth`
  (`access_type=offline`, `prompt=consent` to force a refresh token)
- Token: `https://oauth2.googleapis.com/token`
- Scopes: `openid email https://mail.google.com/`
- Desktop (public) client, **PKCE only, no client secret**.

## Setup (end user / distributor)

**Microsoft (Azure portal → App registrations)**
1. New registration → Supported account types as needed.
2. Authentication → Add platform → *Mobile and desktop applications* → redirect
   URI `http://localhost`. Enable "Allow public client flows".
3. API permissions → add delegated `IMAP.AccessAsUser.All`, `SMTP.Send`
   (Office 365 Exchange Online), plus `offline_access`, `openid`, `email`.
4. Copy the Application (client) ID into `mailClient.oauth.microsoftClientId`.

**Google (Google Cloud Console)**
1. Enable the Gmail API.
2. OAuth consent screen → add scope `https://mail.google.com/`.
3. Credentials → Create OAuth client ID → *Desktop app*. Copy **only the client
   ID** into `mailClient.oauth.googleClientId`. The client secret is **not** used
   (PKCE-only token exchange) and must not be stored in the extension. Add test
   users / publish the consent screen as needed (the `https://mail.google.com/`
   scope is restricted and requires verification for public distribution).

## Default host/port presets

| Provider | IMAP | SMTP |
| --- | --- | --- |
| Microsoft | `outlook.office365.com:993` SSL | `smtp.office365.com:587` STARTTLS |
| Google | `imap.gmail.com:993` SSL | `smtp.gmail.com:465` SSL |

## Risks / notes

- The user must register an OAuth app; this is documented and surfaced via clear
  errors when client IDs are missing.
- Refresh-token rotation (Microsoft) must persist back to `SecretStorage` —
  handled inside `OAuthService`.
- Google refresh tokens are only returned with `access_type=offline` +
  `prompt=consent`; if a user previously consented, re-consent is forced.

## Future work

- Optionally use VS Code's built-in `microsoft` authentication provider to avoid
  Azure registration (blocked today by missing Outlook scope consent on the
  first-party app).
- Provider auto-detection from the email domain.
