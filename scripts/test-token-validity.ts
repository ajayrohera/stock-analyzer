// scripts/test-token-validity.ts
import { KiteConnect } from 'kiteconnect';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function testTokenValidity() {
  try {
    const apiKey = process.env.KITE_API_KEY;
    if (!apiKey) throw new Error('KITE_API_KEY not set');

    // Use the token from your environment variable
    const envToken = process.env.KITE_TOKEN_DATA;
    if (!envToken) throw new Error('KITE_TOKEN_DATA not set');
    
    const tokenData = JSON.parse(envToken);
    
    const kc = new KiteConnect({ api_key: apiKey }) as any;
    kc.setAccessToken(tokenData.accessToken);

    console.log('🧪 Testing token validity with Kite API...');
    console.log('Token age:', Math.floor((Date.now() - tokenData.loginTime) / (1000 * 60 * 60)) + ' hours');
    
    // Test with a simple API call
    try {
      const profile = await kc.getProfile();
      console.log('✅ Token is VALID');
      console.log('User:', profile.user_name);
      console.log('Email:', profile.email);
      return true;
    } catch (apiError: any) {
      console.log('❌ Token is INVALID');
      console.log('Error:', apiError.message);
      if (apiError.code) console.log('Error code:', apiError.code);
      return false;
    }
    
  } catch (error: any) {
    console.error('Test failed:', error.message);
    return false;
  }
}

testTokenValidity();