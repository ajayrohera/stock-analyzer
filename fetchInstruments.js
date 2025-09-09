// This is the new, correct code for fetchInstruments.js
const { KiteConnect } = require("kiteconnect");
const fs = require("fs");
require('dotenv').config({ path: './.env.local' });
const API_KEY = process.env.KITE_API_KEY;
const TOKEN_PATH = "./kite_token.json";

async function fetchAndSaveInstruments() {
  console.log("--- Fetching COMPLETE instrument list (This is the correct version) ---");
  if (!fs.existsSync(TOKEN_PATH)) {
    console.error("ERROR: kite_token.json not found. Please run 'node getKiteAccessToken.js' first.");
    return;
  }
  const tokenData = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
  const kc = new KiteConnect({ api_key: API_KEY });
  kc.setAccessToken(tokenData.accessToken);
  try {
    const allInstruments = await kc.getInstruments(); // Fetches ALL instruments
    fs.writeFileSync("instruments.json", JSON.stringify(allInstruments, null, 2));
    console.log(`--- COMPLETE --- Successfully saved ${allInstruments.length} total instruments to instruments.json`);
  } catch (error) {
    console.error("\nAn error occurred while fetching instruments:", error.message);
  }
}
fetchAndSaveInstruments();