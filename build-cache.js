// This is the code for build-cache.js
const { KiteConnect } = require("kiteconnect");
const { google } = require("googleapis");
const fs = require("fs").promises;
const path = require("path");
require('dotenv').config({ path: '.env.local' });

const tokenPath = path.join(process.cwd(), 'kite_token.json');
const credentialsPath = path.join(process.cwd(), 'credentials.json');

async function buildOptionsCache() {
  console.log("--- Starting Options Cache Builder ---");
  try {
    // 1. Authenticate with Google Sheets
    const auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: 'YOUR_SPREADSHEET_ID', // <--- PASTE YOUR SHEET ID HERE
      range: 'stocks!A2:B',
    });
    const rows = sheetResponse.data.values;
    if (!rows || rows.length === 0) {
      throw new Error("Google Sheet is empty.");
    }
    const tradingSymbols = rows.map(row => row[1]);
    console.log(`Found ${tradingSymbols.length} symbols in your sheet.`);

    // 2. Authenticate with Kite
    const tokenData = JSON.parse(await fs.readFile(tokenPath, 'utf-8'));
    const kc = new KiteConnect({ api_key: process.env.KITE_API_KEY });
    kc.setAccessToken(tokenData.accessToken);

    // 3. Fetch the LIVE, complete instrument list (on your powerful machine)
    console.log("Fetching fresh instrument list from Kite... (This may take a moment)");
    const allInstruments = await kc.getInstruments("NFO");
    console.log(`Fetched ${allInstruments.length} total instruments.`);

    // 4. Do the heavy filtering to create the cache
    const optionsCache = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const symbol of tradingSymbols) {
      const allOptionsForSymbol = allInstruments.filter(
        inst => inst.name === symbol &&
        (inst.instrument_type === 'CE' || inst.instrument_type === 'PE') &&
        inst.expiry >= today
      );
      if (allOptionsForSymbol.length > 0) {
        allOptionsForSymbol.sort((a, b) => a.expiry.getTime() - b.expiry.getTime());
        const nearestExpiry = allOptionsForSymbol[0].expiry;
        const optionsChain = allOptionsForSymbol.filter(inst => inst.expiry.getTime() === nearestExpiry.getTime());
        optionsCache[symbol] = optionsChain;
        console.log(`- Cached ${optionsChain.length} options for ${symbol}`);
      }
    }

    // 5. Save the small, clean cache file
    await fs.writeFile('options_cache.json', JSON.stringify(optionsCache, null, 2));
    console.log("\n--- SUCCESS ---");
    console.log("Created 'options_cache.json'. This is the file you need to upload.");

  } catch (error) {
    console.error("\n--- BUILD FAILED ---");
    console.error(error);
  }
}
buildOptionsCache();