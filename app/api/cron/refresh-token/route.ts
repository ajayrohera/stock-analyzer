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

// --- FIX: .headers.get('set-cookie') only returns ONE cookie even when
// a server sends multiple Set-Cookie headers (very common — Kite's login
// flow sets several: session id, CSRF token, etc.). This was silently
// dropping cookies, leaving our session incomplete for the final OAuth
// step even though login/TOTP appeared to succeed. getSetCookie() is the
// correct modern API for retrieving ALL of them.
function extractCookieString(headers: Headers): string {
  const setCookies = (headers as any).getSetCookie?.() ?? [];
  return setCookies
    .map((c: string) => c.split(';')[0]) // keep only "name=value", drop attributes like Path/Expires
    .join('; ');
}

function mergeCookieStrings(...cookieStrings: string[]): string {
  const jar = new Map<string, string>();
  for (const cs of cookieStrings) {
    if (!cs) continue;
    for (const pair of cs.split(';')) {
      const trimmed = pair.trim();
      if (!trimmed) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      jar.set(trimmed.slice(0, eqIdx), trimmed.slice(eqIdx + 1));
    }
  }
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

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

  // Capture ALL session cookies from the login response — needed for the
  // TOTP step and the final OAuth redirect to be recognized as "already
  // logged in".
  const cookies = extractCookieString(loginRes.headers);

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
  const twofaCookies = extractCookieString(twofaRes.headers);
  const allCookies = mergeCookieStrings(cookies, twofaCookies);
  console.log('🍪 [CRON] Captured cookie names:', allCookies.split(';').map(c => c.trim().split('=')[0]));

  // --- Step 3: hit the real Kite Connect OAuth URL with our authenticated
  // session cookies. Since we're already logged in, Zerodha should redirect
  // immediately to our registered redirect URL with request_token attached.
  //
  // NOTE: skip_session=true is required here — without it, Kite sometimes
  // redirects back to itself with only a sess_id param instead of actually
  // completing the OAuth handoff with request_token. This is a documented
  // quirk on Kite Connect's own developer forum (thread "Autoconnect now
  // working"), not something we're inventing — the intermediate session
  // confirmation step apparently expects this flag when driven outside a
  // real browser.
  const loginUrlRes = await fetch(
    `${KITE_BASE}/connect/login?api_key=${apiKey}&v=3&skip_session=true`,
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
