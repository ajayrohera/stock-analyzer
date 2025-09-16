import { NextResponse } from 'next/server';
import { KiteConnect } from 'kiteconnect';
import { createClient } from 'redis';

// Initialize Redis client
const redis = createClient({
  url: process.env.REDIS_URL,
});

// Connect to Redis
redis.connect().catch(console.error);

// Interface for option data
interface OptionData {
  tradingsymbol: string;
  strike: number;
  instrument_type: string;
  expiry: string;
  oi: number;
  volume: number;
  last_price: number;
  timestamp: string;
}

interface StrikeData {
  ce?: OptionData;
  pe?: OptionData;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { symbol: string };
    const { symbol } = body;
    
    if (!symbol) {
      return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });
    }

    // --- Kite Connection ---
    const tokenData = await redis.get('kite_token');
    if (!tokenData) {
      return NextResponse.json({ error: 'Kite token not found' }, { status: 401 });
    }

    const kc = new KiteConnect({ 
      api_key: process.env.KITE_API_KEY! 
    });
    kc.setAccessToken(JSON.parse(tokenData).accessToken);

    // --- Read options cache from Redis ---
    const optionsCache = await redis.get('options_cache');
    if (!optionsCache) {
      return NextResponse.json({ error: 'Options cache is empty' }, { status: 500 });
    }

    const parsedOptionsCache = JSON.parse(optionsCache);
    const optionsChain = parsedOptionsCache[symbol] as any[];
    
    if (!optionsChain || optionsChain.length === 0) {
      return NextResponse.json({ error: `Options data for '${symbol}' not found in cache` }, { status: 404 });
    }

    // Get live quote data for all options
    const instrumentTokens = optionsChain.map((o: any) => `NFO:${o.tradingsymbol}`);
    const quoteData = await kc.getQuote(instrumentTokens);

    // Prepare detailed OI data
    const oiData: OptionData[] = optionsChain.map((option: any) => {
      const liveData = quoteData[`NFO:${option.tradingsymbol}`] as any;
      return {
        tradingsymbol: option.tradingsymbol,
        strike: option.strike,
        instrument_type: option.instrument_type,
        expiry: option.expiry,
        oi: liveData?.oi || 0,
        volume: liveData?.volume || 0,
        last_price: liveData?.last_price || 0,
        timestamp: new Date().toISOString()
      };
    });

    // Group by strike price for easier analysis
    const byStrike: Record<number, StrikeData> = {};
    
    oiData.forEach((option: OptionData) => {
      if (!byStrike[option.strike]) {
        byStrike[option.strike] = {};
      }
      
      if (option.instrument_type === 'CE') {
        byStrike[option.strike].ce = option;
      } else if (option.instrument_type === 'PE') {
        byStrike[option.strike].pe = option;
      }
    });

    return NextResponse.json({
      symbol,
      total_options: oiData.length,
      by_strike: byStrike,
      raw_data: oiData,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('Debug OI Error:', error);
    return NextResponse.json({ 
      error: error.message || 'Failed to fetch OI data',
      details: error.toString()
    }, { status: 500 });
  }
}