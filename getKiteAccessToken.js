// This is the code for getKiteAccessToken.js

const { KiteConnect } = require("kiteconnect");
const fs = require("fs");
const readline = require("readline").createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Load your API key and secret from the .env.local file
require('dotenv').config({ path: './.env.local' });
const API_KEY = process.env.KITE_API_KEY;
const API_SECRET = process.env.KITE_API_SECRET;

const kc = new KiteConnect({
  api_key: API_KEY,
});

async function runLoginFlow() {
  console.log("--- Kite Access Token Generator ---");

  // 1. Generate the login URL
  const loginURL = kc.getLoginURL();
  console.log("\nSTEP 1: Please open this URL in your browser and log in:");
  console.log(loginURL);

  // 2. Prompt the user to enter the request_token from the redirect URL
  readline.question("\nSTEP 2: After logging in, you will be redirected. Copy the full redirect URL and paste it here:\n> ", async (redirectURL) => {
    try {
      const url = new URL(redirectURL);
      const requestToken = url.searchParams.get("request_token");

      if (!requestToken) {
        console.error("\nERROR: Could not find 'request_token' in the URL you pasted. Please try again.");
        readline.close();
        return;
      }

      console.log("\nSuccess! Got request_token.");

      // 3. Generate the session (access_token)
      console.log("STEP 3: Generating session with access_token...");
      const session = await kc.generateSession(requestToken, API_SECRET);
      
      const accessToken = session.access_token;
      console.log("Success! Got access_token.");

      // 4. Save the access_token to a file
      const tokenData = { accessToken };
      fs.writeFileSync("kite_token.json", JSON.stringify(tokenData, null, 2));
      console.log("\n--- COMPLETE ---");
      console.log("Access token has been successfully saved to kite_token.json");
      console.log("You can now run 'npm run dev' and use the website.");

    } catch (error) {
      console.error("\nAn error occurred:", error.message);
    } finally {
      readline.close();
    }
  });
}

runLoginFlow();