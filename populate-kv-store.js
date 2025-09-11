// This is the correct code for populate-kv-store.js
const { kv } = require('@vercel/kv');
const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config({ path: '.env.development.local' });

async function populateKV() {
  console.log("--- Starting KV Population Script ---");
  try {
    // 1. Authenticate with Google Sheets
    const auth = new google.auth.GoogleAuth({
      keyFile: path.join(process.cwd(), 'credentials.json'),
      scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: 'YOUR_SPREADSHEET_ID', // <--- PASTE YOUR SHEET ID HERE
      range: 'stocks!A2:B',
    });
    const rows = sheetResponse.data.values;
    if (!rows || rows.length === 0) throw new Error("Google Sheet is empty.");
    const tradingSymbols = rows.map(row => row[1]);
    console.log(`Found ${tradingSymbols.length} symbols in your sheet.`);

    // 2. Fetch the COMPLETE instrument list locally
    console.log("Fetching fresh instrument list from local file...");
    const instrumentsJson = await fs.readFile('instruments.json', 'utf8');
    const allInstruments = JSON.parse(instrumentsJson);
    console.log(`Loaded ${allInstruments.length} total instruments.`);

    // 3. Create the small, clean options cache
    const optionsCache = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const symbol of tradingSymbols) {
      const allOptionsForSymbol = allInstruments.filter(
        inst => inst.name === symbol &&
        (inst.instrument_type === 'CE' || inst.instrument_type === 'PE') &&
        new Date(inst.expiry) >= today
      );
      if (allOptionsForSymbol.length > 0) {
        allOptionsForSymbol.sort((a, b) => new Date(a.expiry).getTime() - new Date(b.expiry).getTime());
        const nearestExpiry = allOptionsForSymbol[0].expiry;
        const optionsChain = allOptionsForSymbol.filter(inst => new Date(inst.expiry).getTime() === new Date(nearestExpiry).getTime());
        optionsCache[symbol] = optionsChain;
        console.log(`- Caching ${optionsChain.length} options for ${symbol}`);
      }
    }

    // 4. Upload the clean cache to Vercel KV
    console.log("Uploading options cache to Vercel KV...");
    await kv.set('options_cache', optionsCache);
    
    console.log('\n--- SUCCESS ---');
    console.log("The options cache has been successfully uploaded to your Vercel KV store.");

  } catch (error) {
    console.error('\n--- SCRIPT FAILED ---');
    console.error(error);
  }
}
populateKV();