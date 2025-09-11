// This is the final and correct code for app/api/get-symbols/route.ts
import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import path from 'path';

export async function GET() {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: path.join(process.cwd(), 'credentials.json'),
      scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: 'YOUR_SPREADSHEET_ID', // <--- PASTE YOUR SHEET ID HERE
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