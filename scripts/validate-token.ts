// scripts/validate-token.ts
import { KiteConnect } from 'kiteconnect';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

console.log('🔍 Token Validation Script');
console.log('=' .repeat(40));

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const tokenPath = path.join(process.cwd(), 'kite_token.json');

// Helper function to safely parse JSON
async function safeReadJson(filePath: string): Promise<any> {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.log(`❌ Failed to read ${filePath}`);
    return null;
  }
}

// Function to convert to IST (UTC+5:30)
function toIST(timestamp: number): string {
  const date = new Date(timestamp);
  const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
  const istTime = new Date(date.getTime() + istOffset);
  
  return istTime.toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, ' IST');
}

// Function to calculate time until expiration
function getTimeUntilExpiration(loginTime: number): string {
  const tokenLifetime = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  const expirationTime = loginTime + tokenLifetime;
  const timeRemaining = expirationTime - Date.now();
  
  if (timeRemaining <= 0) {
    return 'EXPIRED';
  }
  
  const hoursRemaining = Math.floor(timeRemaining / (1000 * 60 * 60));
  const minutesRemaining = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
  
  return `${hoursRemaining}h ${minutesRemaining}m`;
}

async function validateToken() {
  try {
    console.log('📋 Checking token file...');
    
    const tokenData = await safeReadJson(tokenPath);
    if (!tokenData) {
      console.log('❌ No token file found');
      return false;
    }

    console.log('📄 Token file content:');
    console.log(JSON.stringify(tokenData, null, 2));
    console.log('');

    const apiKey = process.env.KITE_API_KEY;
    if (!apiKey) {
      console.log('❌ KITE_API_KEY not found in environment');
      return false;
    }

    console.log('✅ KITE_API_KEY found');
    console.log('🔑 Access token present:', !!tokenData.accessToken);
    console.log('🔄 Refresh token present:', !!tokenData.refreshToken);
    console.log('');

    if (!tokenData.accessToken) {
      console.log('❌ No access token found in token file');
      return false;
    }

    // Initialize KiteConnect and test the token
    console.log('🧪 Testing API access with current token...');
    const kc = new KiteConnect({
      api_key: apiKey
    }) as any;
    
    kc.setAccessToken(tokenData.accessToken);

    try {
      const profile = await kc.getProfile();
      console.log('✅ TOKEN VALIDATION SUCCESSFUL!');
      console.log('');
      console.log('👤 User Profile:');
      console.log(`   Name: ${profile.user_name}`);
      console.log(`   Email: ${profile.email}`);
      console.log(`   User ID: ${profile.user_id}`);
      console.log('');
      
      // Get precise token timing information
      const loginTime = tokenData.loginTime || 0;
      const currentTime = Date.now();
      const tokenAgeMs = currentTime - loginTime;
      const tokenAgeHours = Math.floor(tokenAgeMs / (1000 * 60 * 60));
      const tokenAgeMinutes = Math.floor((tokenAgeMs % (1000 * 60 * 60)) / (1000 * 60));
      
      console.log('⏰ Token Timing Information (IST):');
      console.log(`   Token created: ${toIST(loginTime)}`);
      console.log(`   Current time:  ${toIST(currentTime)}`);
      console.log(`   Token age:     ${tokenAgeHours}h ${tokenAgeMinutes}m`);
      console.log(`   Time until expiration: ${getTimeUntilExpiration(loginTime)}`);
      
      // Kite tokens typically expire in 24 hours
      const timeRemaining = (loginTime + 24 * 60 * 60 * 1000) - currentTime;
      const hoursRemaining = Math.floor(timeRemaining / (1000 * 60 * 60));
      
      if (hoursRemaining < 4) {
        console.log('⚠️  WARNING: Token will expire soon!');
      } else if (hoursRemaining < 12) {
        console.log('⚠️  NOTE: Token has limited time remaining');
      } else {
        console.log('✅ Token has sufficient time for deployment');
      }
      
      if (!tokenData.refreshToken) {
        console.log('');
        console.log('⚠️  IMPORTANT: No refresh token available');
        console.log('   This token cannot be automatically refreshed');
        console.log('   It will expire and need manual reauthentication');
      }
      
      console.log('');
      console.log('🚀 READY FOR DEPLOYMENT!');
      console.log('   The current access token is valid and can be pushed to Git/Vercel');
      console.log('');
      console.log('💡 Note: This token will expire on:', toIST(loginTime + 24 * 60 * 60 * 1000));
      
      return true;
      
    } catch (error: any) {
      console.log('❌ TOKEN VALIDATION FAILED!');
      console.log(`   Error: ${error.message}`);
      console.log('');
      
      if (error.message.includes('token') || error.message.includes('expired') || 
          error.message.includes('invalid') || error.status === 401) {
        console.log('⚠️  The access token appears to be invalid or expired');
        console.log('   Please run: npx ts-node scripts/authenticate.ts');
      }
      
      return false;
    }

  } catch (error) {
    console.log('❌ Unexpected error during validation:', error);
    return false;
  }
}

// Execute validation
console.log('🚀 Starting token validation...\n');
validateToken().then(isValid => {
  console.log('=' .repeat(40));
  if (isValid) {
    console.log('✅ VALIDATION COMPLETE - Token is ready for use');
    process.exit(0);
  } else {
    console.log('❌ VALIDATION COMPLETE - Token needs attention');
    process.exit(1);
  }
});