// scripts/debug-env.js
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

console.log('Environment variables:');
console.log('REDIS_URL:', process.env.REDIS_URL);
console.log('KITE_API_KEY exists:', !!process.env.KITE_API_KEY);
console.log('KITE_API_SECRET exists:', !!process.env.KITE_API_SECRET);