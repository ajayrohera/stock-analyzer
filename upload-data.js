// This is the complete and correct code for upload-data.js

const { put } = require('@vercel/blob');
const fs = require('fs').promises;
const path = require('path');
// This line is crucial for the script to find your Vercel Blob token
require('dotenv').config({ path: '.env.development.local' });

async function uploadFiles() {
  console.log("--- Vercel Blob Uploader ---");
  console.log("Uploading essential files to your cloud storage...");

  try {
    // 1. Upload credentials.json
    const credentialsPath = path.join(process.cwd(), 'credentials.json');
    const credentials = await fs.readFile(credentialsPath, 'utf8');
    // The 'pathname' is the name of the file in the cloud
    const { url: credentialsUrl } = await put('credentials.json', credentials, { access: 'public' });
    console.log(`- Successfully uploaded credentials.json to: ${credentialsUrl}`);

    // 2. Upload kite_token.json
    const kiteTokenPath = path.join(process.cwd(), 'kite_token.json');
    const kiteToken = await fs.readFile(kiteTokenPath, 'utf8');
    const { url: tokenUrl } = await put('kite_token.json', kiteToken, { access: 'public' });
    console.log(`- Successfully uploaded kite_token.json to: ${tokenUrl}`);

    // 3. Upload options_cache.json
    const optionsCachePath = path.join(process.cwd(), 'options_cache.json');
    const optionsCache = await fs.readFile(optionsCachePath, 'utf8');
    const { url: cacheUrl } = await put('options_cache.json', optionsCache, { access: 'public' });
    console.log(`- Successfully uploaded options_cache.json to: ${cacheUrl}`);
    
    console.log('\n--- SUCCESS ---');
    console.log('All essential data files are now in your Vercel Blob store.');
    console.log('You can now push your code to GitHub to trigger the final deployment.');

  } catch (error) {
    console.error('\n--- UPLOAD FAILED ---');
    console.error('An error occurred:', error.message);
    console.error('Please ensure that you have run "vercel link" and "vercel env pull" and that the files exist.');
  }
}

uploadFiles();