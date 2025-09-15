// scripts/debug-oi-options.ts
import { KiteConnect } from 'kiteconnect';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function debugOptionsOI() {
  try {
    const apiKey = process.env.KITE_API_KEY;
    if (!apiKey) throw new Error('KITE_API_KEY not set');

    // Get token from environment
    const envToken = process.env.KITE_TOKEN_DATA;
    if (!envToken) throw new Error('KITE_TOKEN_DATA not set');
    
    const tokenData = JSON.parse(envToken);
    if (!tokenData.accessToken) throw new Error('Invalid token data');

    const kc = new KiteConnect({ api_key: apiKey }) as any;
    kc.setAccessToken(tokenData.accessToken);

    // Real options contracts (these will have OI data)
    const optionsContracts = [
      'NFO:NIFTY25SEP24000CE',  // NIFTY 24000 Call
      'NFO:NIFTY25SEP24000PE',  // NIFTY 24000 Put
      'NFO:BANKNIFTY25SEP52000CE', // BANKNIFTY 52000 Call
      'NFO:BANKNIFTY25SEP52000PE',  // BANKNIFTY 52000 Put
      'NFO:RELIANCE25SEP1400CE',    // RELIANCE 1400 Call
      'NFO:RELIANCE25SEP1400PE'     // RELIANCE 1400 Put
    ];

    console.log('🔍 Debugging Options Contracts for OI Data');
    console.log('=' .repeat(50));

    for (const instrumentId of optionsContracts) {
      try {
        console.log(`\n📊 ${instrumentId}:`);
        const quote = await kc.getQuote([instrumentId]);
        const data = quote[instrumentId];
        
        if (!data) {
          console.log('❌ No data returned for this contract');
          continue;
        }

        // Check for OI specifically
        const oiValue = data.oi || data.open_interest;
        const volume = data.volume;
        const lastPrice = data.last_price;
        
        console.log('Open Interest:', oiValue !== undefined ? oiValue : 'NOT AVAILABLE');
        console.log('Volume:', volume !== undefined ? volume : 'NOT AVAILABLE');
        console.log('Last Price:', lastPrice !== undefined ? lastPrice : 'NOT AVAILABLE');
        
        if (oiValue !== undefined && oiValue > 0) {
          console.log('✅ OI data available!');
        } else if (oiValue === 0) {
          console.log('⚠️ OI is 0 (contract may be expired or illiquid)');
        } else {
          console.log('❌ No OI data found');
        }
        
      } catch (error: any) {
        console.log(`❌ Failed to get ${instrumentId}:`, error.message);
        if (error.code) {
          console.log('Error code:', error.code);
        }
      }
    }
    
  } catch (error: any) {
    console.error('❌ Debug failed:', error.message);
  }
}

debugOptionsOI();