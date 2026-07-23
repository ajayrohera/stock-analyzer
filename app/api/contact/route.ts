// app/api/contact/route.ts
//
// Handles contact form submissions properly — appends each message as a
// new row to a "ContactMessages" tab in the same Google Sheet already used
// for stock symbol mapping (reuses existing auth/credentials, no new
// service needed).
//
// SETUP REQUIRED: in your Google Sheet, create a new tab named exactly
// "ContactMessages" (case-sensitive) with headers in row 1, e.g.:
//   Timestamp | Name | Email | Message
// Also make sure the sheet is shared with your GOOGLE_CLIENT_EMAIL service
// account as EDITOR (not just Viewer) — the existing analyze route only
// needed read access, but this route needs write access.

import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, message } = body as { name?: string; email?: string; message?: string };

    // Basic validation — don't silently accept empty submissions
    if (!name?.trim() || !email?.trim() || !message?.trim()) {
      return NextResponse.json(
        { error: 'Name, email, and message are all required.' },
        { status: 400 }
      );
    }

    // Simple email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return NextResponse.json(
        { error: 'Please enter a valid email address.' },
        { status: 400 }
      );
    }

    const auth = new google.auth.GoogleAuth({
      credentials: {
        type: 'service_account',
        project_id: process.env.GOOGLE_PROJECT_ID,
        private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
        private_key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        client_id: process.env.GOOGLE_CLIENT_ID,
      },
      // NOTE: full read/write scope needed here, unlike the read-only scope
      // used elsewhere in this app for symbol lookups.
      scopes: 'https://www.googleapis.com/auth/spreadsheets',
    });

    const sheets = google.sheets({ version: 'v4', auth });

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'ContactMessages!A:D',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          new Date().toISOString(),
          name.trim(),
          email.trim(),
          message.trim(),
        ]],
      },
    });

    console.log(`✅ Contact message saved from ${email.trim()}`);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('❌ Failed to save contact message:', error.message);
    return NextResponse.json(
      { error: 'Failed to send message. Please try again later.' },
      { status: 500 }
    );
  }
}
