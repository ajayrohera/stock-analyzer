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
        ohlc?: {
            open: number;
            high: number;
            low: number;
            close: number;
        };
    }
}
interface LtpQuote {
    [key: string]: { instrument_token: number; last_price: number; }
}

interface Instrument {
    tradingsymbol: string;
    strike: number;
    instrument_type: string;
    expiry: string;
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
  tooltip?: string; // Added for tooltip data
}

// Only keep major indices and exceptionally important stocks
const specialPsychologicalLevels: Record<string, number[]> = {
  'NIFTY': [24000, 24500, 25000, 25500, 26000],
  'BANKNIFTY': [52000, 53000, 54000, 55000, 56000],
  'RELIANCE': [2400, 2500, 2600, 2700, 2800, 2900, 3000],
};

// Initialize Redis client
const redis = createClient({
  url: process.env.REDIS_URL,
});

// Connect to Redis
redis.connect().catch(console.error);

// --- HELPER FUNCTIONS ---
async function getHistoricalData(symbol: string): Promise<HistoricalData[]> {
  try {
    const historyData = await redis.get('volume_history');
    if (!historyData) return [];
    
    const history = JSON.parse(historyData as string);
    return history[symbol] || [];
  } catch (error) {
    console.error('Error reading historical data:', error);
    return [];
  }
}

function generatePsychologicalLevels(currentPrice: number): number[] {
  const levels: number[] = [];
  const priceRange = currentPrice * 0.2; // ±20% range
  
  // Generate round numbers based on price range
  const increment = currentPrice > 1000 ? 100 : 50;
  const start = Math.round((currentPrice - priceRange) / increment) * increment;
  const end = Math.round((currentPrice + priceRange) / increment) * increment;
  
  for (let price = start; price <= end; price += increment) {
    // Only include significant round numbers
    if (price % 100 === 0 || (price % 50 === 0 && currentPrice < 500)) {
      levels.push(price);
    }
  }
  
  return levels.filter(level => Math.abs(level - currentPrice) > increment);
}

function getPsychologicalLevels(symbol: string, currentPrice: number): number[] {
  // Use special levels for major indices, generate dynamically for others
  const upperSymbol = symbol.toUpperCase();
  if (specialPsychologicalLevels[upperSymbol]) {
    return specialPsychologicalLevels[upperSymbol];
  }
  return generatePsychologicalLevels(currentPrice);
}

function calculateChangePercent(currentPrice: number, historicalData: HistoricalData[]): number {
  if (!historicalData.length || !currentPrice) return 0;
  
  // Get the most recent previous day's data (excluding today if it exists)
  const previousDays = historicalData.filter(entry => {
    const entryDate = new Date(entry.date);
    const today = new Date();
    return entryDate.getDate() !== today.getDate() || 
           entryDate.getMonth() !== today.getMonth() ||
           entryDate.getFullYear() !== today.getFullYear();
  });
  
  if (previousDays.length === 0) return 0;
  
  // Sort by date descending and get the latest previous close
  previousDays.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const previousClose = previousDays[0]?.lastPrice;
  
  if (!previousClose) return 0;
  
  return ((currentPrice - previousClose) / previousClose) * 100;
}

function calculateVolumeMetrics(historicalData: HistoricalData[], currentVolume?: number) {
  if (!historicalData.length) return {};
  
  // Calculate 20-day average volume (excluding today)
  const recentData = historicalData
    .filter(entry => entry.totalVolume > 0)
    .slice(0, 20);
  
  if (recentData.length === 0) return {};
  
  const totalVolume = recentData.reduce((sum, entry) => sum + entry.totalVolume, 0);
  const avg20DayVolume = totalVolume / recentData.length;
  
  let todayVolumePercentage = 0;
  let estimatedTodayVolume = 0;
  
  if (currentVolume && currentVolume > 0) {
    // Calculate percentage of daily average (even if market is still open)
    const marketProgress = new Date().getHours() >= 9 && new Date().getHours() < 15 ? 
      (new Date().getHours() - 9) + (new Date().getMinutes() / 60) : 6.25; // Default to full day if outside market hours
    
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

function findResistanceLevels(currentPrice: number, optionsByStrike: Record<number, { ce_oi: number, pe_oi: number }>): SupportResistanceLevel[] {
  const resistanceLevels: SupportResistanceLevel[] = [];
  const strikes = Object.keys(optionsByStrike).map(Number).sort((a, b) => a - b);
  
  // Debug: Log all strikes with significant OI
  console.log('=== DEBUG: RESISTANCE ANALYSIS ===');
  strikes.forEach(strike => {
    if (strike > currentPrice) {
      const { ce_oi, pe_oi } = optionsByStrike[strike];
      if (ce_oi > 50000) {
        console.log(`Strike ${strike}: CE=${ce_oi}, PE=${pe_oi}, Ratio=${pe_oi > 0 ? (ce_oi/pe_oi).toFixed(2) : '∞'}`);
      }
    }
  });
  
  for (const strike of strikes) {
    if (strike > currentPrice) {
      const { ce_oi, pe_oi } = optionsByStrike[strike];
      
      // Skip if insufficient OI
      if (ce_oi < 50000) continue;
      
      const oiRatio = pe_oi > 0 ? ce_oi / pe_oi : Infinity;
      
      // Check if this is a local maximum for call OI compared to adjacent strikes
      const prevStrike = strikes.find(s => s === strike - 50);
      const nextStrike = strikes.find(s => s === strike + 50);
      const prevStrikeOI = prevStrike ? optionsByStrike[prevStrike]?.ce_oi || 0 : 0;
      const nextStrikeOI = nextStrike ? optionsByStrike[nextStrike]?.ce_oi || 0 : 0;
      
      const isLocalMax = ce_oi > prevStrikeOI && ce_oi > nextStrikeOI;
      
      if (oiRatio >= 2 && ce_oi > 50000 && isLocalMax) {
        let strength: 'weak' | 'medium' | 'strong' = 'medium';
        const actualRatio = pe_oi > 0 ? (ce_oi / pe_oi).toFixed(2) : '∞';
        let tooltip = `CE: ${(ce_oi/100000).toFixed(1)}L, PE: ${(pe_oi/100000).toFixed(1)}L, Ratio: ${actualRatio}:1`;
        
        // CORRECTED STRENGTH CALCULATION:
        if ((oiRatio >= 3 && ce_oi > 1000000) || (oiRatio >= 4) || (ce_oi > 2000000)) {
          strength = 'strong';
          tooltip += ' | Strong: High CE dominance';
        } else if (oiRatio < 1.8 || ce_oi < 100000) {
          strength = 'weak';
          tooltip += ' | Weak: Low CE dominance';
        } else {
          tooltip += ' | Medium: Moderate CE dominance';
        }
        
        resistanceLevels.push({
          price: strike,
          strength,
          type: 'resistance',
          tooltip
        });
      }
    }
  }
  
  return resistanceLevels.sort((a, b) => a.price - b.price);
}

function findSupportLevels(currentPrice: number, optionsByStrike: Record<number, { ce_oi: number, pe_oi: number }>): SupportResistanceLevel[] {
  const supportLevels: SupportResistanceLevel[] = [];
  const strikes = Object.keys(optionsByStrike).map(Number).sort((a, b) => a - b);
  
  // Debug: Log all strikes with significant OI
  console.log('=== DEBUG: SUPPORT ANALYSIS ===');
  strikes.forEach(strike => {
    if (strike < currentPrice) {
      const { ce_oi, pe_oi } = optionsByStrike[strike];
      if (pe_oi > 50000) {
        console.log(`Strike ${strike}: PE=${pe_oi}, CE=${ce_oi}, Ratio=${ce_oi > 0 ? (pe_oi/ce_oi).toFixed(2) : '∞'}`);
      }
    }
  });
  
  for (const strike of strikes) {
    if (strike < currentPrice) {
      const { ce_oi, pe_oi } = optionsByStrike[strike];
      
      // Skip if insufficient OI
      if (pe_oi < 50000) continue;
      
      // Calculate ratio correctly
      const actualRatio = ce_oi > 0 ? pe_oi / ce_oi : Infinity;
      const actualRatioFormatted = ce_oi > 0 ? (pe_oi / ce_oi).toFixed(2) : '∞';
      
      // Check if this is a local maximum for put OI compared to adjacent strikes
      const prevStrike = strikes.find(s => s === strike - 50);
      const nextStrike = strikes.find(s => s === strike + 50);
      const prevStrikeOI = prevStrike ? optionsByStrike[prevStrike]?.pe_oi || 0 : 0;
      const nextStrikeOI = nextStrike ? optionsByStrike[nextStrike]?.pe_oi || 0 : 0;
      
      const isLocalMax = pe_oi > prevStrikeOI && pe_oi > nextStrikeOI;
      
      if (actualRatio >= 2 && pe_oi > 50000 && isLocalMax) {
        let strength: 'weak' | 'medium' | 'strong' = 'medium';
        let tooltip = `PE: ${(pe_oi/100000).toFixed(1)}L, CE: ${(ce_oi/100000).toFixed(1)}L, Ratio: ${actualRatioFormatted}:1`;
        
        // Use the correct ratio for strength classification
        if ((actualRatio >= 3 && pe_oi > 1000000) || (actualRatio >= 4) || (pe_oi > 2000000)) {
          strength = 'strong';
          tooltip += ' | Strong: High PE dominance';
        } else if (actualRatio < 1.8 || pe_oi < 100000) {
          strength = 'weak';
          tooltip += ' | Weak: Low PE dominance';
        } else {
          tooltip += ' | Medium: Moderate PE dominance';
        }
        
        supportLevels.push({
          price: strike,
          strength,
          type: 'support',
          tooltip
        });
      }
    }
  }
  
  return supportLevels.sort((a, b) => b.price - a.price);
}

function calculateSupportResistance(
  history: HistoricalData[],
  currentPrice: number
): SupportResistanceLevel[] {
  if (!history || history.length === 0 || !currentPrice) return [];
  
  const levels: SupportResistanceLevel[] = [];
  const priceLevels = new Map<number, number>();
  
  // Analyze price levels with volume concentration
  history.forEach(entry => {
    if (entry.lastPrice) {
      const roundedPrice = Math.round(entry.lastPrice / 5) * 5; // Group nearby prices
      const volume = priceLevels.get(roundedPrice) || 0;
      priceLevels.set(roundedPrice, volume + (entry.totalVolume || 0));
    }
  });
  
  // Convert to array and sort by volume
  const sortedLevels = Array.from(priceLevels.entries())
    .sort((a, b) => b[1] - a[1]) // Sort by volume descending
    .slice(0, 10); // Top 10 levels
  
  // Classify as support or resistance
  sortedLevels.forEach(([price, volume]) => {
    const distancePercent = Math.abs((price - currentPrice) / currentPrice) * 100;
    
    // Only consider levels within 20% of current price
    if (distancePercent <= 20) {
      let strength: 'weak' | 'medium' | 'strong' = 'weak';
      let tooltip = `Hist. Volume: ${(volume/100000).toFixed(1)}L`;
      
      // Determine strength based on volume percentile
      const maxVolume = Math.max(...sortedLevels.map(l => l[1]));
      const volumeRatio = volume / maxVolume;
      
      if (volumeRatio > 0.7) {
        strength = 'strong';
        tooltip += ' | Strong: High volume concentration';
      } else if (volumeRatio > 0.4) {
        strength = 'medium';
        tooltip += ' | Medium: Moderate volume';
      } else {
        tooltip += ' | Weak: Low volume';
      }
      
      levels.push({
        price,
        strength,
        type: price < currentPrice ? 'support' : 'resistance',
        tooltip
      });
    }
  });
  
  return levels;
}

function calculateEnhancedSupportResistance(
  symbol: string,
  history: HistoricalData[],
  currentPrice: number,
  optionsByStrike: Record<number, { ce_oi: number, pe_oi: number }>
): SupportResistanceLevel[] {
  const baseLevels = calculateSupportResistance(history, currentPrice);
  
  // Find resistance and support levels based on OI data
  const oiResistanceLevels = findResistanceLevels(currentPrice, optionsByStrike);
  const oiSupportLevels = findSupportLevels(currentPrice, optionsByStrike);
  
  // Merge OI-based levels with base levels (OI levels take priority)
  oiResistanceLevels.forEach(oiLevel => {
    const existingIndex = baseLevels.findIndex(l => Math.abs(l.price - oiLevel.price) <= 10);
    if (existingIndex !== -1) {
      // Replace with OI-based level if it exists
      baseLevels[existingIndex] = oiLevel;
    } else {
      baseLevels.push(oiLevel);
    }
  });
  
  oiSupportLevels.forEach(oiLevel => {
    const existingIndex = baseLevels.findIndex(l => Math.abs(l.price - oiLevel.price) <= 10);
    if (existingIndex !== -1) {
      // Replace with OI-based level if it exists
      baseLevels[existingIndex] = oiLevel;
    } else {
      baseLevels.push(oiLevel);
    }
  });
  
  // Add psychological levels
  const psychLevels = getPsychologicalLevels(symbol, currentPrice);
  psychLevels.forEach(level => {
    const distancePercent = Math.abs(level - currentPrice) / currentPrice * 100;
    if (distancePercent <= 20) {
      const existingLevel = baseLevels.find(l => Math.abs(l.price - level) <= 10);
      
      if (!existingLevel) {
        baseLevels.push({
          price: level,
          strength: 'medium',
          type: level < currentPrice ? 'support' : 'resistance',
          tooltip: 'Psychological level'
        });
      } else if (existingLevel.strength === 'weak') {
        // Upgrade weak levels to medium if they match psychological levels
        existingLevel.strength = 'medium';
        existingLevel.tooltip += ' + Psychological level';
      }
    }
  });
  
  // Merge and deduplicate levels
  const uniqueLevels = baseLevels.filter((level, index, array) =>
    index === array.findIndex(l => Math.abs(l.price - level.price) <= 5)
  );
  
  // Sort by proximity to current price
  return uniqueLevels
    .sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice))
    .slice(0, 5); // Return top 5 closest levels
}

// --- MAIN API FUNCTION ---
export async function POST(request: Request) {
  try {
    const apiKey = process.env.KITE_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Server configuration error: KITE_API_KEY is missing.' }, { status: 500 });
    }

    const body = await request.json() as { symbol: string };
    const { symbol: displayName } = body;
    if (!displayName) {
      return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });
    }

    // --- Google Sheets Logic ---
    const auth = new google.auth.GoogleAuth({
      credentials: {
        type: 'service_account',
        project_id: process.env.GOOGLE_PROJECT_ID,
        private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        client_id: process.env.GOOGLE_CLIENT_ID,
      },
      scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly'
    });
    
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'storks!A2:B',
    });
    
    const rows = sheetResponse.data.values;
    if (!rows || rows.length === 0) {
        return NextResponse.json({ error: 'Google Sheet is empty.' }, { status: 500 }); 
    }
    const row = rows.find(r => r[0] === displayName);
    if (!row || !row[1]) { 
        return NextResponse.json({ error: `TradingSymbol for '${displayName}' not found in Google Sheet.` }, { status: 404 }); 
    }
    const tradingSymbol = row[1];

    // --- Kite Connection ---
    const tokenData = await redis.get('kite_token');
    if (!tokenData) {
      return NextResponse.json({ error: 'Kite token not found. Please run the login script.' }, { status: 401 });
    }

    const kc = new KiteConnect({ api_key: apiKey });
    kc.setAccessToken(JSON.parse(tokenData as string).accessToken);

    // --- Read options cache from Redis ---
    const optionsCache = await redis.get('options_cache');
    if (!optionsCache) {
      return NextResponse.json({ error: 'Options cache is empty. Please run the population script.' }, { status: 500 });
    }

    const parsedOptionsCache = JSON.parse(optionsCache as string);
    const optionsChain = parsedOptionsCache[tradingSymbol];
    if (!optionsChain || optionsChain.length === 0) {
        return NextResponse.json({ error: `Options data for '${tradingSymbol}' not found in cache.` }, { status: 404 });
    }
    
    const exchange = (displayName === 'NIFTY' || displayName === 'BANKNIFTY') ? 'NFO' : 'NSE';

    // Get quote data for the main symbol to get volume
    const quoteDataForSymbol: QuoteData = await kc.getQuote([`${exchange}:${tradingSymbol}`]);
    const ltp = quoteDataForSymbol[`${exchange}:${tradingSymbol}`]?.last_price || 0;
    const currentVolume = quoteDataForSymbol[`${exchange}:${tradingSymbol}`]?.volume;

    if (ltp === 0) {
        return NextResponse.json({ error: `Could not fetch live price for '${tradingSymbol}'.` }, { status: 404 });
    }
    
    // Get historical data for change percent and support/resistance
    const historicalData = await getHistoricalData(displayName.toUpperCase());
    const changePercent = calculateChangePercent(ltp, historicalData);
    const volumeMetrics = calculateVolumeMetrics(historicalData, currentVolume);

    const instrumentTokens = optionsChain.map((o: Instrument) => `NFO:${o.tradingsymbol}`);
    const quoteData: QuoteData = await kc.getQuote(instrumentTokens);

    // --- Calculation Logic ---
    let totalCallOI = 0, totalPutOI = 0, highestCallOI = 0, resistance = 0, highestPutOI = 0, support = 0;
    let totalCallVolume = 0, totalPutVolume = 0;
    let otmCallOI = 0, otmPutOI = 0;
    const strikePrices: number[] = [];
    const optionsByStrike: Record<number, { ce_oi: number, pe_oi: number }> = {};
    
    for (const opt of optionsChain) {
        const liveData = quoteData[`NFO:${opt.tradingsymbol}`];
        const oi = liveData?.oi || 0;
        const volume = liveData?.volume || 0;
        if (oi > 0) {
            const strike = opt.strike;
            if (!optionsByStrike[strike]) optionsByStrike[strike] = { ce_oi: 0, pe_oi: 0 };
            if (opt.instrument_type === 'CE') {
                totalCallOI += oi;
                totalCallVolume += volume;
                if (strike > ltp) {
                    if (oi > highestCallOI) { highestCallOI = oi; resistance = strike; }
                    otmCallOI += oi;
                }
                optionsByStrike[strike].ce_oi = oi;
            } else if (opt.instrument_type === 'PE') {
                totalPutOI += oi;
                totalPutVolume += volume;
                if (strike < ltp) {
                    if (oi > highestPutOI) { highestPutOI = oi; support = strike; }
                    otmPutOI += oi;
                }
                optionsByStrike[strike].pe_oi = oi;
            }
            if (!strikePrices.includes(strike)) strikePrices.push(strike);
        }
    }

    // === ADD DEBUG LOGGING HERE ===
    console.log('=== DEBUG: RAW OPTIONS DATA ===');
    console.log('Trading Symbol:', tradingSymbol);
    console.log('LTP:', ltp);
    console.log('Total Options:', optionsChain.length);

    // Log specific strike prices around 900
    for (const opt of optionsChain) {
        const liveData = quoteData[`NFO:${opt.tradingsymbol}`];
        if (Math.abs(opt.strike - 900) <= 100) { // Check strikes around 900
            console.log(`Strike ${opt.strike} ${opt.instrument_type}:`, {
                tradingsymbol: opt.tradingsymbol,
                oi: liveData?.oi,
                volume: liveData?.volume,
                last_price: liveData?.last_price,
                expiry: opt.expiry
            });
        }
    }

    // Log the optionsByStrike structure for debugging
    console.log('=== DEBUG: optionsByStrike STRUCTURE ===');
    Object.entries(optionsByStrike).forEach(([strike, oiData]) => {
        if (Math.abs(Number(strike) - 900) <= 100) {
            console.log(`Strike ${strike}:`, oiData);
        }
    });
    // === END DEBUG LOGGING ===
    
    if (strikePrices.length === 0) { return NextResponse.json({ error: `Found options but no OI data for ${displayName}.` }, { status: 404 }); }
    strikePrices.sort((a, b) => a - b);
    
    if (resistance === 0) {
        const otmCalls = strikePrices.filter(strike => strike > ltp);
        if (otmCalls.length > 0) resistance = otmCalls[0];
    }
    if (support === 0) {
        const otmPuts = strikePrices.filter(strike => strike < ltp);
        if (otmPuts.length > 0) support = otmPuts[otmPuts.length - 1];
    }
    
    // Calculate enhanced support/resistance WITH OI DATA
    const supportResistanceLevels = calculateEnhancedSupportResistance(
      displayName.toUpperCase(),
      historicalData,
      ltp,
      optionsByStrike
    );
    
    const closestSupport = supportResistanceLevels
      .filter(level => level.type === 'support')
      .sort((a, b) => Math.abs(a.price - ltp) - Math.abs(b.price - ltp))[0];

    const closestResistance = supportResistanceLevels
      .filter(level => level.type === 'resistance')
      .sort((a, b) => Math.abs(a.price - ltp) - Math.abs(b.price - ltp))[0];
    
    let sentiment = "Neutral";
    const pcrIsBullish = totalCallOI > 0 ? totalPutOI / totalCallOI > 1.1 : false;
    const pcrIsBearish = totalCallOI > 0 ? totalPutOI / totalCallOI < 0.9 : false;
    const otmRatio = otmCallOI > 0 ? otmPutOI / otmCallOI : 0;
    if (pcrIsBullish && otmRatio > 1.5) sentiment = "Strongly Bullish";
    else if (pcrIsBearish && otmRatio < 0.75) sentiment = "Strongly Bearish";
    else if (totalCallOI > 0 && totalPutOI / totalCallOI > 1.0) sentiment = "Slightly Bullish";
    else if (totalCallOI > 0 && totalPutOI / totalCallOI < 1.0) sentiment = "Slightly Bearish";
    
    const pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 0;
    const volumePcr = totalCallVolume > 0 ? totalPutVolume / totalCallVolume : 0;
    
    let minLoss = Infinity, maxPain = 0;
    if (strikePrices.length > 0) {
        for (const expiryStrike of strikePrices) {
            let totalLoss = 0;
            for (const strike of strikePrices) {
                const option = optionsByStrike[strike];
                if (option.ce_oi > 0 && expiryStrike > strike) totalLoss += (expiryStrike - strike) * option.ce_oi;
                if (option.pe_oi > 0 && expiryStrike < strike) totalLoss += (strike - expiryStrike) * option.pe_oi;
            }
            if (totalLoss < minLoss) { minLoss = totalLoss; maxPain = expiryStrike; }
        }
    }
    
    const nearestOption = optionsChain[0];
    const formattedExpiry = new Date(nearestOption.expiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');

    // --- FINAL RESPONSE DATA ---
    const responseData = {
        symbol: displayName.toUpperCase(), 
        pcr: parseFloat(pcr.toFixed(2)), 
        volumePcr: parseFloat(volumePcr.toFixed(2)),
        maxPain, 
        resistance: closestResistance?.price || resistance, 
        support: closestSupport?.price || support, 
        sentiment, 
        expiryDate: formattedExpiry, 
        supportStrength: closestSupport?.strength || 'medium', 
        resistanceStrength: closestResistance?.strength || 'medium',
        supportTooltip: closestSupport?.tooltip || '',
        resistanceTooltip: closestResistance?.tooltip || '',
        ltp: ltp,
        lastRefreshed: new Date().toLocaleTimeString('en-IN', { 
          timeZone: 'Asia/Kolkata', 
          hour: '2-digit', 
          minute: '2-digit', 
          hour12: true 
        }),
        changePercent: parseFloat(changePercent.toFixed(2)),
        ...volumeMetrics
    };
    
    return NextResponse.json(responseData);

  } catch (error: unknown) {
    const err = error as Error & { error_type?: string };
    console.error("API Error:", err.message);
    if (err.error_type === 'TokenException') {
        return NextResponse.json({ error: 'Kite token has expired. Please run the login script again.' }, { status: 401 });
    }
    return NextResponse.json({ error: 'An error occurred fetching data.' }, { status: 500 });
  }
}