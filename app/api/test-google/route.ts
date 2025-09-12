import { NextResponse } from 'next/server';
import { google } from 'googleapis';

export async function GET() {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        type: 'service_account',
        project_id: process.env.GOOGLE_PROJECT_ID,
        private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'), // ← THE FIX
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        client_id: process.env.GOOGLE_CLIENT_ID,
      },
      scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly'
    });

    const sheets = google.sheets({ version: 'v4', auth });
    
    // Test a simple sheets API call
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'stocks!A1:B5', // Test with a small range
    });

    return NextResponse.json({
      status: 'Google Sheets connection successful',
      data: response.data,
      sheetId: process.env.GOOGLE_SHEET_ID
    });

  } catch (error: unknown) {
    return NextResponse.json({
      status: 'Google Sheets connection FAILED',
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error
    }, { status: 500 });
  }
}