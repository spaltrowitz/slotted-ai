#!/usr/bin/env node

/**
 * Minimal Gmail OAuth + send helper (no external deps).
 *
 * Usage:
 *   node send-mail.mjs auth-url
 *   node send-mail.mjs exchange-code "<CODE_FROM_GOOGLE>"
 *   node send-mail.mjs send --to user@example.com --subject "Hello" --text "Hi there"
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REDIRECT_URI
 *   GMAIL_SENDER_EMAIL
 *
 * For send:
 *   GOOGLE_REFRESH_TOKEN
 */

import { writeFile } from 'node:fs/promises';

const GOOGLE_OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const value = rest[i + 1];
      flags[key] = value;
      i += 1;
    }
  }
  return { command, rest, flags };
}

function buildAuthUrl() {
  const clientId = requiredEnv('GOOGLE_CLIENT_ID');
  const redirectUri = requiredEnv('GOOGLE_REDIRECT_URI');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPE,
    access_type: 'offline',
    prompt: 'consent'
  });

  return `${GOOGLE_OAUTH_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const clientId = requiredEnv('GOOGLE_CLIENT_ID');
  const clientSecret = requiredEnv('GOOGLE_CLIENT_SECRET');
  const redirectUri = requiredEnv('GOOGLE_REDIRECT_URI');

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });

  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);
  }

  return data;
}

async function refreshAccessToken() {
  const clientId = requiredEnv('GOOGLE_CLIENT_ID');
  const clientSecret = requiredEnv('GOOGLE_CLIENT_SECRET');
  const refreshToken = requiredEnv('GOOGLE_REFRESH_TOKEN');

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });

  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Access token refresh failed: ${JSON.stringify(data)}`);
  }

  return data.access_token;
}

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildRawMessage({ from, to, subject, text }) {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    text
  ];
  return base64UrlEncode(lines.join('\r\n'));
}

async function sendEmail({ to, subject, text }) {
  if (!to || !subject || !text) {
    throw new Error('For send, pass --to, --subject, and --text');
  }

  const from = requiredEnv('GMAIL_SENDER_EMAIL');
  const accessToken = await refreshAccessToken();
  const raw = buildRawMessage({ from, to, subject, text });

  const res = await fetch(GMAIL_SEND_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ raw })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Gmail send failed: ${JSON.stringify(data)}`);
  }

  return data;
}

async function main() {
  const { command, rest, flags } = parseArgs(process.argv.slice(2));

  if (command === 'auth-url') {
    console.log(buildAuthUrl());
    return;
  }

  if (command === 'exchange-code') {
    const code = rest[0];
    if (!code) {
      throw new Error('Missing authorization code. Usage: exchange-code "<code>"');
    }

    const tokenResult = await exchangeCodeForTokens(code);
    console.log('Token exchange successful. Save refresh_token securely.');
    console.log(JSON.stringify(tokenResult, null, 2));

    if (tokenResult.refresh_token) {
      const tokenFile = 'gmail-refresh-token.local.json';
      await writeFile(
        tokenFile,
        JSON.stringify({ refresh_token: tokenResult.refresh_token }, null, 2),
        'utf8'
      );
      console.log(`Wrote refresh token to ${tokenFile} (local helper file).`);
    }
    return;
  }

  if (command === 'send') {
    const result = await sendEmail({
      to: flags.to,
      subject: flags.subject,
      text: flags.text
    });
    console.log('Email sent.');
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('Usage:');
  console.log('  node send-mail.mjs auth-url');
  console.log('  node send-mail.mjs exchange-code "<CODE_FROM_GOOGLE>"');
  console.log('  node send-mail.mjs send --to user@example.com --subject "Hello" --text "Hi there"');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
