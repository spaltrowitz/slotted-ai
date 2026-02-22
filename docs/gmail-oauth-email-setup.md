# Gmail OAuth setup for Slotted email notifications

This file includes:
1. What was implemented in this workspace.
2. Exactly what you still need to do in Google Cloud and Gmail.
3. How to test sending.
4. What to do next for production.

## Implemented for you

- Added helper script: [tools/gmail-oauth/send-mail.mjs](../tools/gmail-oauth/send-mail.mjs)
  - `auth-url`: generates OAuth consent URL.
  - `exchange-code`: exchanges auth code for tokens and prints refresh token.
  - `send`: sends an email using `gmail.send` scope.
- Added env template: [tools/gmail-oauth/.env.example](../tools/gmail-oauth/.env.example)
- Added token ignore rule in [.gitignore](../.gitignore) for local token file.

## Step-by-step actions you need to do

## 1) Create the Gmail sender account

1. Create the account you want to send from (example: `slotted.ai@gmail.com`).
2. Enable 2-Step Verification on that account.
3. Keep this account owned by your company and secured with recovery options.

## 2) Create Google Cloud project

1. Open Google Cloud Console.
2. Create a new project (example name: `slotted-email`).
3. Ensure billing is enabled if prompted.

## 3) Enable Gmail API

1. In Google Cloud, go to APIs & Services → Library.
2. Search for **Gmail API**.
3. Click **Enable**.

## 4) Configure OAuth consent screen

1. Go to APIs & Services → OAuth consent screen.
2. Choose **External** (unless this is strictly internal to one Workspace org).
3. Fill app name, user support email, and developer contact email.
4. Add scope: `https://www.googleapis.com/auth/gmail.send`.
5. Add your own Google account as a test user (and any teammates testing).
6. Save.

## 5) Create OAuth client credentials

1. Go to APIs & Services → Credentials.
2. Click **Create Credentials** → **OAuth client ID**.
3. Application type: **Web application**.
4. Add redirect URI(s):
   - Local test example: `http://localhost:3000/oauth/google/callback`
   - Prod example: `https://api.slotted.ai/oauth/google/callback`
5. Save and copy:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`

## 6) Set local env vars for first test

Use values from OAuth credentials:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GMAIL_SENDER_EMAIL` (example: `slotted.ai@gmail.com`)

Do not commit secrets into the repo.

## 7) Run OAuth consent once and get refresh token

From [tools/gmail-oauth/send-mail.mjs](../tools/gmail-oauth/send-mail.mjs):

1. Generate URL with command `auth-url`.
2. Open that URL in browser.
3. Log in as your sender Gmail account.
4. Approve access.
5. Copy returned `code` from callback URL.
6. Exchange code using command `exchange-code "<code>"`.
7. Save `refresh_token` in your secret manager as `GOOGLE_REFRESH_TOKEN`.

Important: if no refresh token returns, repeat consent with `prompt=consent` (already set in script) and make sure you are not reusing a prior grant state.

## 8) Send a test email

Use command `send` with:

- `--to`
- `--subject`
- `--text`

If successful, Gmail API returns a message id.

## 9) Production hardening (required)

1. Move secrets to managed secret storage (not env file committed to git).
2. Add a retry policy with exponential backoff for transient failures.
3. Add idempotency key per notification event to prevent duplicate emails.
4. Add unsubscribe/preferences handling in your app.
5. Add alerting when token refresh fails (`invalid_grant`, revoked token).
6. Log send attempts and outcomes with correlation IDs.

## 10) Limits and recommendation

Gmail API is okay for low volume or early testing.
For production transactional scale, migrate to Postmark/SES/SendGrid/Resend using your domain sender (example: `notify@slotted.ai`).

---

## Minimal backend integration plan (next)

1. In your notifications pipeline, map each in-app notification event to an email template.
2. Queue emails in an `email_outbox` table with status fields.
3. Worker process:
   - fetch pending rows,
   - send using Gmail API,
   - mark sent/retry/failed,
   - store provider message id.
4. Gate by user preference flags before queueing.
