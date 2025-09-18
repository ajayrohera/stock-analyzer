// This is the final, complete, and unabbreviated code for app/api/analyze/route.ts

import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { KiteConnect } from 'kiteconnect';
import { createClient } from 'redis';

// --- HELPER TYPES ---
interface QuoteData {
    [key: string]: { 
        instrument_token: number; 
        last_price: number; 
        oi?: number; 
        volume?: number;
        ohlc?: { open: number; high: number; low: number; close: number; };
    }
}
interface LtpQuote {
    [key: string]: { instrument_token: number; last_price: number; }
}
interface Instrument {
    tradingsymbol: string;
    strike: number;
    instrument_type: string;
    expiry: Date;
    name: string;
}
interface HistoricalData {
  date: string;
  totalVolume: number;
  lastPrice?: number;
  timestamp: number;
}
interface SupportResistanceLevel {
  price: number;
  strength: 'weak' | 'medium' | 'strong';
  type: 'support' | 'resistance';
  tooltip?: string;
}

const specialPsychologicalLevels: Record<string, number[]> = {
  'NIFTY': [24000, 24500, 25000, 25500, 26000],
  'BANKNIFTY': [52000, 53000, 54000, 55000, 56000],
  'RELIANCE': [2400, 2500, 2600, 2700, 2800, 2900, 3000],
};

const redis = createClient({ url: process.env.REDIS_URL });
redis.connect().catch(console.error);

// --- HELPER FUNCTIONS ---

// === DIAGNOSTIC LOGGING ADDED HERE ===
async function getHistoricalData(symbol: string): Promise<HistoricalData[]> {
  try {
    const historyData = await redis.get('volume_history');
    if (!historyData) {
      console.error('[DIAGNOSTIC] Failed to get "volume_history" key from Redis.');
      return [];
    }

    const history = JSON.parse(historyData as string);
    
    // 1. Log the key we are looking for
    console.log(`[DIAGNOSTIC] Key we are looking for: "${symbol}"`);

    // 2. Log all available keys in the Redis data
    console.log(`[DIAGNOSTIC] Available keys in Redis: [${Object.keys(history).join(', ')}]`);

    const result = history[symbol];

    // 3. Log whether we found a match
    if (result) {
      console.log(`[DIAGNOSTIC] SUCCESS: Found a match for "${symbol}".`);
    } else {
      console.error(`[DIAGNOSTIC] FAILURE: No match found for "${symbol}". Returning empty array.`);
    }

    return result || [];
  } catch (error) { 
    console.error('[DIAGNOSTIC] Error in getHistoricalData:', error); 
    return []; 
  }
}

function generatePsychologicalLevels(currentPrice: number): number[] {
  const levels: number[] = [];
  const priceRange = currentPrice * 0.2;
  const increment = currentPrice > 1000 ? 100 : 50;
  const start = Math.round((currentPrice - priceRange) / increment) * increment;
  const end = Math.round((currentPrice + priceRange) / increment) * increment;
  for (let price = start; price <= end; price += increment) {
    if (price % 100 === 0 || (price % 50 === 0 && currentPrice < 500)) levels.push(price);
  }
  return levels.filter(level => Math.abs(level - currentPrice) > increment);
}

function getPsychologicalLevels(symbol: string, currentPrice: number): number[] {
  const upperSymbol = symbol.toUpperCase();
  if (specialPsychologicalLevels[upperSymbol]) return specialPsychologicalLevels[upperSymbol];
  return generatePsychologicalLevels(currentPrice);
}

function calculateChangePercent(currentPrice: number, historicalData: HistoricalData[]): number {
  if (!historicalData || historicalData.length === 0 || !currentPrice) return 0;
  const today = new Date();
  const previousDays = historicalData.filter(entry => {
    const entryDate = new Date(entry.date);
    return entryDate.setHours(0,0,0,0) !== today.setHours(0,0,0,0);
  });
  if (previousDays.length === 0) return 0;
  previousDays.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const previousClose = previousDays[0]?.lastPrice;
  if (!previousClose) return 0;
  return ((currentPrice - previousClose) / previousClose) * 100;
}

function calculateVolumeMetrics(historicalData: HistoricalData[], currentVolume?: number) {
  if (!historicalData.length) return {};
  const recentData = historicalData.filter(entry => entry.totalVolume > 0).slice(0, 20);
  if (recentData.length === 0) return {};
  const totalVolume = recentData.reduce((sum, entry) => sum + entry.totalVolume, 0);
  const avg20DayVolume = totalVolume / recentData.length;
  let todayVolumePercentage = 0, estimatedTodayVolume = 0;
  if (currentVolume && currentVolume > 0) {
    const marketProgress = new Date().getHours() >= 9 && new Date().getHours() < 15 ? (new Date().getHours() - 9) + (new Date().getMinutes() / 60) : 6.25;
    const expectedDailyVolume = avg20DayVolume * (marketProgress / 6.25);
    todayVolumePercentage = (currentVolume / expectedDailyVolume) * 100;
    estimatedTodayVolume = currentVolume * (6.25 / marketProgress);
  }
  return {
    avg20DayVolume: Math.round(avg20DayVolume),
    todayVolumePercentage: parseFloat(todayVolumePercentage.toFixed(1)),
    estimatedTodayVolume: Math.round(estimatedTodayVolume)
  };
}

function findResistanceLevels(currentPrice: number, optionsByStrike: Record<number, { ce_oi: number, pe_oi: number }>, allStrikes: number[]): SupportResistanceLevel[] {
  const candidates: SupportResistanceLevel[] = [];
  for (const strike of allStrikes) {
    if (strike > currentPrice) {
      const { ce_oi, pe_oi } = optionsByStrike[strike] || { ce_oi: 0, pe_oi: 0 };
      if (ce_oi < 30000 || pe_oi < 1000) continue;
      const oiRatio = ce_oi / pe_oi;
      if (oiRatio >= 1.3) {
        let strength: 'weak' | 'medium' | 'strong';
        let tooltip = `CE: ${(ce_oi / 100000).toFixed(1)}L, PE: ${(pe_oi / 100000).toFixed(1)}L, Ratio: ${oiRatio.toFixed(2)}:1`;
        if ((oiRatio >= 3 && ce_oi > 1000000) || (oiRatio >= 4) || (ce_oi > 2000000)) {
            strength = 'strong';
            tooltip += ' | Strong';
        } else if (oiRatio >= 1.8) {
            strength = 'medium';
            tooltip += ' | Medium';
        } else {
            strength = 'weak';
            tooltip += ' | Weak';
        }
        candidates.push({ price: strike, strength, type: 'resistance', tooltip });
      }
    }
  }
  if (candidates.length === 0) return [];
  candidates.sort((a, b) => (optionsByStrike[b.price]?.ce_oi || 0) - (optionsByStrike[a.price]?.ce_oi || 0));
  const significantLevels = candidates.slice(0, 5);
  return significantLevels.sort((a, b) => a.price - b.price);
}

function findSupportLevels(currentPrice: number, optionsByStrike: Record<number, { ce_oi: number, pe_oi: number }>, allStrikes: number[]): SupportResistanceLevel[] {
  const candidates: SupportResistanceLevel[] = [];
  for (const strike of allStrikes) {
    if (strike < currentPrice) {
      const { ce_oi, pe_oi } = optionsByStrike[strike] || { ce_oi: 0, pe_oi: 0 };
      if (pe_oi < 30000 || ce_oi < 1000) continue;
      const oiRatio = pe_oi / ce_oi;
      if (oiRatio >= 1.3) {
        let strength: 'weak' | 'medium' | 'strong';
        let tooltip = `PE: ${(pe_oi / 100000).toFixed(1)}L, CE: ${(ce_oi / 100000).toFixed(1)}L, Ratio: ${oiRatio.toFixed(2)}:1`;
        if ((oiRatio >= 3 && pe_oi > 1000000) || (oiRatio >= 4) || (pe_oi > 2000000)) {
            strength = 'strong';
            tooltip += ' | Strong';
        } else if (oiRatio >= 1.8) {
            strength = 'medium';
            tooltip += ' | Medium';
        } else {
            strength = 'weak';
            tooltip += ' | Weak';
        }
        candidates.push({ price: strike, strength, type: 'support', tooltip });
      }
    }
  }
  if (candidates.length === 0) return [];
  candidates.sort((a, b) => (optionsByStrike[b.price]?.pe_oi || 0) - (optionsByStrike[a.price]?.pe_oi || 0));
  const significantLevels = candidates.slice(0, 5);
  return significantLevels.sort((a, b) => b.price - a.price);
}

function calculateSupportResistance(history: HistoricalData[], currentPrice: number): SupportResistanceLevel[] {
  if (!history || history.length === 0 || !currentPrice) return [];
  const levels: SupportResistanceLevel[] = [];
  const priceLevels = new Map<number, number>();
  const priceRange = currentPrice * 0.20;
  history.forEach(entry => {
    if (entry.lastPrice && Math.abs(entry.lastPrice - currentPrice) <= priceRange) {
      const roundedPrice = Math.round(entry.lastPrice / 5) * 5;
      const volume = priceLevels.get(roundedPrice) || 0;
      priceLevels.set(roundedPrice, volume + (entry.totalVolume || 0));
    }
  });
  const sortedLevels = Array.from(priceLevels.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  sortedLevels.forEach(([price]) => {
      levels.push({ price, strength: 'weak', type: price < currentPrice ? 'support' : 'resistance', tooltip: 'Historical Volume Level' });
  });
  return levels;
}

function getFinalLevels(
  symbol: string, 
  history: HistoricalData[], 
  currentPrice: number, 
  optionsByStrike: Record<number, { ce_oi: number, pe_oi: number }>, 
  allStrikes: number[]
): { supports: SupportResistanceLevel[], resistances: SupportResistanceLevel[] } {
  const allSupports: SupportResistanceLevel[] = [];
  const allResistances: SupportResistanceLevel[] = [];
  const addLevel = (level: SupportResistanceLevel, list: SupportResistanceLevel[]) => {
    if (!list.some(l => l.price === level.price)) list.push(level);
  };
  findSupportLevels(currentPrice, optionsByStrike, allStrikes).forEach(l => addLevel(l, allSupports));
  findResistanceLevels(currentPrice, optionsByStrike, allStrikes).forEach(l => addLevel(l, allResistances));
  calculateSupportResistance(history, currentPrice).forEach(l => {
    if (l.type === 'support') addLevel(l, allSupports);
    else addLevel(l, allResistances);
  });
  getPsychologicalLevels(symbol, currentPrice).forEach(price => {
    const level: SupportResistanceLevel = { price, strength: 'medium', type: price < currentPrice ? 'support' : 'resistance', tooltip: 'Psychological Level' };
    if (level.type === 'support') addLevel(level, allSupports);
    else addLevel(level, allResistances);
  });
  allSupports.sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice));
  allResistances.sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice));
  return {
    supports: allSupports.slice(0, 2),
    resistances: allResistances.slice(0, 2)
  };
}


// --- MAIN API FUNCTION ---
export async function POST(request: Request) {
  try {
    const apiKey = process.env.KITE_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });

    const body = await request.json() as { symbol: string };
    const { symbol: displayName } = body;
    if (!displayName) return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });

    const auth = new google.auth.GoogleAuth({
      credentials: {
        type: 'service_account',
        project_id: process.env.GOOGLE_PROJECT_ID,
        private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
        private_key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        client_id: process.env.GOOGLE_CLIENT_ID,
      },
      scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly'
    });
    
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetResponse = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'stocks!A2:B' });
    const rows = sheetResponse.data.values;
    if (!rows || rows.length === 0) return NextResponse.json({ error: 'Google Sheet is empty.' }, { status: 500 }); 
    const row = rows.find(r => r[0] === displayName);
    if (!row || !row[1]) return NextResponse.json({ error: `TradingSymbol for '${displayName}' not found.` }, { status: 404 }); 
    const tradingSymbol = row[1];

    const tokenData = await redis.get('kite_token');
    if (!tokenData) return NextResponse.json({ error: 'Kite token not found.' }, { status: 401 });

    const kc = new KiteConnect({ api_key: apiKey });
    kc.setAccessToken(JSON.parse(tokenData).accessToken);

    const allInstruments = await kc.getInstruments('NFO');
    const unfilteredOptionsChain = allInstruments.filter(instrument => 
      instrument.name === tradingSymbol.toUpperCase() && (instrument.instrument_type === 'CE' || instrument.instrument_type === 'PE')
    );
    if (unfilteredOptionsChain.length === 0) {
        return NextResponse.json({ error: `No options found for '${tradingSymbol}'` }, { status: 404 });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let nearestExpiry = new Date('2999-12-31');
    for (const opt of unfilteredOptionsChain) {
        const expiryDate = new Date(opt.expiry);
        if (expiryDate >= today && expiryDate < nearestExpiry) {
            nearestExpiry = expiryDate;
        }
    }

    const optionsChain = unfilteredOptionsChain.filter(instrument => new Date(instrument.expiry).getTime() === nearestExpiry.getTime());
    
    const exchange = (displayName === 'NIFTY' || displayName === 'BANKNIFTY') ? 'NFO' : 'NSE';
    const quoteDataForSymbol: QuoteData = await kc.getQuote([`${exchange}:${tradingSymbol}`]);
    const ltp = quoteDataForSymbol[`${exchange}:${tradingSymbol}`]?.last_price || 0;
    const currentVolume = quoteDataForSymbol[`${exchange}:${tradingSymbol}`]?.volume;

    if (ltp === 0) return NextResponse.json({ error: `Could not fetch live price for '${tradingSymbol}'.` }, { status: 404 });
    
    const historicalData = await getHistoricalData(displayName.toUpperCase());
    const changePercent = calculateChangePercent(ltp, historicalData);
    const volumeMetrics = calculateVolumeMetrics(historicalData, currentVolume);

    const instrumentTokens = optionsChain.map((o: Instrument) => `NFO:${o.tradingsymbol}`);
    const quoteData: QuoteData = await kc.getQuote(instrumentTokens);

    const optionsByStrike: Record<number, { ce_oi: number, pe_oi: number }> = {};
    const strikePrices = [...new Set(optionsChain.map(o => o.strike))].sort((a, b) => a - b);
    
    let totalCallOI = 0, totalPutOI = 0, totalCallVolume = 0, totalPutVolume = 0;

    for (const strike of strikePrices) {
        const ceOpt = optionsChain.find(o => o.strike === strike && o.instrument_type === 'CE');
        const peOpt = optionsChain.find(o => o.strike === strike && o.instrument_type === 'PE');
        const ceLiveData = ceOpt ? quoteData[`NFO:${ceOpt.tradingsymbol}`] : null;
        const peLiveData = peOpt ? quoteData[`NFO:${peOpt.tradingsymbol}`] : null;
        const ce_oi = ceLiveData?.oi || 0;
        const pe_oi = peLiveData?.oi || 0;
        optionsByStrike[strike] = { ce_oi, pe_oi };
        totalCallOI += ce_oi;
        totalPutOI += pe_oi;
        totalCallVolume += ceLiveData?.volume || 0;
        totalPutVolume += peLiveData?.volume || 0;
    }

    const { supports: supportLevels, resistances: resistanceLevels } = getFinalLevels(
      displayName.toUpperCase(), 
      historicalData, 
      ltp, 
      optionsByStrike, 
      strikePrices
    );

    const finalSupport = supportLevels.length > 0 ? supportLevels[0].price : 0;
    const finalResistance = resistanceLevels.length > 0 ? resistanceLevels[0].price : 0;
    
    const pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 0; 
    let sentiment = "Neutral";
    if (pcr > 1.1) sentiment = "Bullish";
    else if (pcr < 0.9) sentiment = "Bearish";
    else if (pcr > 1.0) sentiment = "Slightly Bullish";
    else if (pcr < 1.0) sentiment = "Slightly Bearish";
    
    const volumePcr = totalCallVolume > 0 ? totalPutVolume / totalCallVolume : 0;
    
    let minLoss = Infinity, maxPain = 0;
    for (const expiryStrike of strikePrices) {
        let totalLoss = 0;
        for (const strike of strikePrices) {
            const option = optionsByStrike[strike];
            if (option.ce_oi > 0 && expiryStrike > strike) totalLoss += (expiryStrike - strike) * option.ce_oi;
            if (option.pe_oi > 0 && expiryStrike < strike) totalLoss += (strike - expiryStrike) * option.pe_oi;
        }
        if (totalLoss < minLoss) { minLoss = totalLoss; maxPain = expiryStrike; }
    }
    
    const formattedExpiry = new Date(nearestExpiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');

    const responseData = {
        symbol: displayName.toUpperCase(),
        ltp: ltp,
        lastRefreshed: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }),
        changePercent: parseFloat(changePercent.toFixed(2)),
        ...volumeMetrics,
        expiryDate: formattedExpiry,
        sentiment,
        pcr: parseFloat(pcr.toFixed(2)),
        volumePcr: parseFloat(volumePcr.toFixed(2)),
        maxPain,
        support: finalSupport, 
        resistance: finalResistance,
        supports: supportLevels,
        resistances: resistanceLevels,
    };
    
    return NextResponse.json(responseData);

  } catch (error) {
    const err = error as Error & { error_type?: string };
    console.error("API Error:", err.message, err.stack);
    if (err.error_type === 'TokenException') {
        return NextResponse.json({ error: 'Kite token has expired. Please run the login script again.' }, { status: 401 });
    }
    return NextResponse.json({ error: 'An error occurred fetching data.' }, { status: 500 });
  }
}