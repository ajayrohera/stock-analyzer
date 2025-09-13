// scripts/debug-kite.ts
import { KiteConnect } from 'kiteconnect';

console.log('KiteConnect type:', typeof KiteConnect);
console.log('KiteConnect methods:');
const kc = new KiteConnect({ api_key: 'test' });
const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(kc))
  .filter(prop => typeof kc[prop as keyof typeof kc] === 'function');
console.log(methods);