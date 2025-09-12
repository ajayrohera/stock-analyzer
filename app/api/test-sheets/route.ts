// app/api/test-sheets/route.ts
import { NextResponse } from 'next/server';
import { google } from 'googleapis';

export async function GET() {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        type: 'service_account',
        project_id: process.env.GOOGLE_PROJECT_ID,
        private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        client_id: process.env.GOOGLE_CLIENT_ID,
      },
      scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly'
    });

    const sheets = google.sheets({ version: 'v4', auth });
    
    // Test access to the sheet
    const response = await sheets.spreadsheets.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
    });

    return NextResponse.json({
      status: 'Google Sheets access successful',
      sheetTitle: response.data.properties?.title,
      sheetId: process.env.GOOGLE_SHEET_ID
    });

  } catch (error: any) {
    return NextResponse.json({
      status: 'Google Sheets access FAILED',
      error: error.message,
      sheetId: process.env.GOOGLE_SHEET_ID,
      clientEmail: process.env.GOOGLE_CLIENT_EMAIL
    }, { status: 500 });
  }
}