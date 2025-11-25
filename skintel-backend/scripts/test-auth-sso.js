#!/usr/bin/env node

/**
 * Quick script to test the Clerk SSO auth endpoint.
 *
 * Usage:
 *   node scripts/test-auth-sso.js \\
 *     --base-url=https://skintel.screcraft.io \\
 *     --session-id=sess_xxx \\
 *     --provider=clerk_google \\
 *     --clerk-token=eyJhbGci... \\
 *     --clerk-session-id=sess_xxx
 *
 * You can also set the following env vars instead of CLI args:
 *   TEST_BASE_URL, TEST_SESSION_ID, TEST_PROVIDER,
 *   TEST_CLERK_TOKEN, TEST_CLERK_SESSION_ID
 */

const axios = require('axios');

const argMap = {
  'base-url': 'baseUrl',
  'session-id': 'sessionId',
  provider: 'provider',
  'clerk-token': 'clerkToken',
  'clerk-session-id': 'clerkSessionId',
};

const config = {
  baseUrl: process.env.TEST_BASE_URL || 'http://localhost:3000',
  sessionId: process.env.TEST_SESSION_ID,
  provider: process.env.TEST_PROVIDER || 'clerk_google',
  clerkToken: process.env.TEST_CLERK_TOKEN,
  clerkSessionId: process.env.TEST_CLERK_SESSION_ID,
};

for (const arg of process.argv.slice(2)) {
  if (!arg.startsWith('--')) continue;
  const [rawKey, ...rest] = arg.slice(2).split('=');
  const key = argMap[rawKey];
  if (!key) continue;
  const value = rest.length ? rest.join('=') : undefined;
  config[key] = value;
}

const missing = Object.entries({
  sessionId: 'session-id / TEST_SESSION_ID',
  clerkToken: 'clerk-token / TEST_CLERK_TOKEN',
  clerkSessionId: 'clerk-session-id / TEST_CLERK_SESSION_ID',
}).filter(([key]) => !config[key]);

if (missing.length) {
  console.error('Missing required inputs:');
  missing.forEach(([, label]) => console.error(`  - ${label}`));
  process.exit(1);
}

async function main() {
  const payload = {
    session_id: config.sessionId,
    provider: config.provider,
    clerk_token: config.clerkToken,
    clerk_session_id: config.clerkSessionId,
  };

  const url = new URL('/v1/auth/sso', config.baseUrl).toString();

  console.log('POST', url);
  console.log('Payload:', JSON.stringify(payload, null, 2));

  try {
    const { data, status } = await axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 1000 * 15,
    });
    console.log('Status:', status);
    console.log('Response:', JSON.stringify(data, null, 2));
  } catch (error) {
    if (error.response) {
      console.error('Request failed with status', error.response.status);
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Request error:', error.message);
    }
    process.exitCode = 1;
  }
}

main();

