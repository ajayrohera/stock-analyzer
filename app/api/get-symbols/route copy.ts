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
      scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID, // Use environment variable
      range: 'stocks!A2:A',
    });

    const values = response.data.values;
    if (!values || values.length === 0) {
      return NextResponse.json({ error: 'No symbols found in Google Sheet.' }, { status: 404 });
    }

    const symbols = values.map(row => row[0]);
    return NextResponse.json(symbols);

  } catch (error: unknown) {
    const err = error as Error;
    console.error("Error fetching symbol list:", err.message);
    return NextResponse.json({ error: 'Failed to load symbol list.' }, { status: 500 });
  }
}