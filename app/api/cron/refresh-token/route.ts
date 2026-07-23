// app/api/cron/refresh-token/route.ts
//
// Fully automated daily Kite Connect token refresh, triggered by Vercel Cron.
// Replaces the manual `npx tsx scripts/authenticate.ts` step.
//
// Uses the same login + TOTP flow documented across many public Zerodha
// algo-trading tutorials/repos: POST username+password -> POST TOTP code ->
// hit the Kite Connect OAuth URL with the now-authenticated session cookies
// (which redirects immediately, no further manual login needed) -> extract
// request_token from the redirect -> exchange for access_token exactly like
// the manual flow already does -> save to Redis with 24h expiry.
//
// Required NEW environment variables (add in Vercel dashboard, never commit):
//   KITE_USER_ID       - your Zerodha login ID (e.g. "AB1234")
//   KITE_PASSWORD      - your Zerodha login password
//   KITE_TOTP_SECRET   - the TOTP secret key from Zerodha's External TOTP setup
//   CRON_SECRET        - a random string YOU choose, used to verify Vercel's
//                        cron request is legitimate (see route body below)
//
// Requires the "otpauth" package: npm install otpauth

import { NextRequest, NextResponse } from 'next/server';
import { KiteConnect } from 'kiteconnect';
import { createClient } from 'redis';
import * as OTPAuth from 'otpauth';

const KITE_BASE = 'https://kite.zerodha.com';

async function loginAndGetRequestToken(): Promise<string> {
  const userId = process.env.KITE_USER_ID!;
  const password = process.env.KITE_PASSWORD!;
  const totpSecret = process.env.KITE_TOTP_SECRET!;
  const apiKey = process.env.KITE_API_KEY!;

  // --- Step 1: username + password ---
  const loginRes = await fetch(`${KITE_BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ user_id: userId, password }),
  });
  const loginData = await loginRes.json();
  if (!loginData?.data?.request_id) {
    throw new Error(`Login step failed: ${JSON.stringify(loginData)}`);
  }
  const requestId = loginData.data.request_id;

  // Capture session cookies from the login response — needed for the
  // TOTP step and the final OAuth redirect to be recognized as "already
  // logged in".
  const cookies = loginRes.headers.get('set-cookie') || '';

  // --- Step 2: TOTP (External 2FA) ---
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(totpSecret),
    digits: 6,
    period: 30,
  });
  const totpCode = totp.generate();

  const twofaRes = await fetch(`${KITE_BASE}/api/twofa`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookies,
    },
    body: new URLSearchParams({
      user_id: userId,
      request_id: requestId,
      twofa_value: totpCode,
      twofa_type: 'totp',
    }),
  });
  const twofaData = await twofaRes.json();
  if (twofaData?.status !== 'success') {
    throw new Error(`TOTP step failed: ${JSON.stringify(twofaData)}`);
  }
  const twofaCookies = twofaRes.headers.get('set-cookie') || '';
  const allCookies = `${cookies}; ${twofaCookies}`;

  // --- Step 3: hit the real Kite Connect OAuth URL with our authenticated
  // session cookies. Since we're already logged in, Zerodha redirects
  // immediately to our registered redirect URL with request_token attached
  // — no manual browser step needed.
  const loginUrlRes = await fetch(
    `${KITE_BASE}/connect/login?api_key=${apiKey}&v=3`,
    { headers: { Cookie: allCookies }, redirect: 'manual' }
  );

  const location = loginUrlRes.headers.get('location');
  if (!location) {
    throw new Error('No redirect received from Kite Connect OAuth URL — login may have failed');
  }

  const requestToken = new URL(location).searchParams.get('request_token');
  if (!requestToken) {
    throw new Error(`No request_token found in redirect: ${location}`);
  }

  return requestToken;
}

export async function GET(request: NextRequest) {
  // Verify this is really Vercel Cron calling us, not a random internet
  // request hitting a guessable URL.
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('🔄 [CRON] Starting automated token refresh...');
    const requestToken = await loginAndGetRequestToken();
    console.log('✅ [CRON] Got request_token, generating session...');

    const kc = new KiteConnect({ api_key: process.env.KITE_API_KEY! });
    const session = await kc.generateSession(requestToken, process.env.KITE_API_SECRET!);

    const tokenData = {
      accessToken: session.access_token,
      refreshToken: session.refresh_token || '',
      loginTime: Date.now(),
    };

    const client = createClient({
      url: process.env.REDIS_URL,
      password: process.env.REDIS_PASSWORD,
    });
    await client.connect();
    await client.setEx('kite_token', 24 * 60 * 60, JSON.stringify(tokenData));
    await client.quit();

    console.log('✅ [CRON] Token saved to Redis. Automated refresh complete.');
    return NextResponse.json({ success: true, timestamp: new Date().toISOString() });
  } catch (error: any) {
    console.error('❌ [CRON] Automated token refresh failed:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
