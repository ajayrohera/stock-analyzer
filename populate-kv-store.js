// This is the code for populate-kv-store.js
const { kv } = require('@vercel/kv');
const fs = require('fs').promises;
require('dotenv').config({ path: '.env.development.local' });

async function uploadInstruments() {
  console.log('Reading local instruments.json file...');
  try {
    const instrumentsJson = await fs.readFile('instruments.json', 'utf8');
    const instruments = JSON.parse(instrumentsJson);
    
    console.log(`Found ${instruments.length} instruments. Uploading to Vercel KV...`);
    
    // This sets the entire list of instruments to a single key in the database
    await kv.set('instruments_cache', instruments);
    
    console.log('\n--- SUCCESS ---');
    console.log('The instruments data has been successfully uploaded to your Vercel KV store.');
  } catch (error) {
    console.error('\n--- UPLOAD FAILED ---');
    console.error(error);
  }
}
uploadInstruments();