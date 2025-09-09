// This is the new code for app/api/get-symbols/route.ts

import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import path from 'path';

export async function GET() {
  try {
    // 1. Configure the Google Sheets client
    const auth = new google.auth.GoogleAuth({
      keyFile: path.join(process.cwd(), 'credentials.json'),
      scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // 2. Fetch the data from your sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: '1NeUJ-N3yNAhtLN0VPV71vY88MTTAYGEW8gGxtNbVcRU', // <--- IMPORTANT: PASTE YOUR SHEET ID HERE
      range: 'stocks!A2:A', // Fetches all rows from Column A, starting from the second row
    });

    const values = response.data.values;
    if (!values || values.length === 0) {
      return NextResponse.json({ error: 'No symbols found in the Google Sheet.' }, { status: 404 });
    }

    // 3. Flatten the array and send it to the frontend
    const symbols = values.map(row => row[0]);
    return NextResponse.json(symbols);

  } catch (error: any) {
    console.error("Error fetching from Google Sheets:", error);
    return NextResponse.json({ error: 'Failed to load symbol list from Google Sheets.' }, { status: 500 });
  }
}