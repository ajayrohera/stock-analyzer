// This is the final version, combining your superior logic with the new feature.

import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { KiteConnect, Instrument } from 'kiteconnect';
import fs from 'fs/promises';
import path from 'path';

const tokenPath = path.join(process.cwd(), 'kite_token.json');
const instrumentsPath = path.join(process.cwd(), 'instruments.json');
const volumeHistoryPath = path.join(process.cwd(), 'volume_history.json');

// --- HELPER TYPES ---
// MODIFIED: Added 'volume' to the quote data type
interface QuoteData {
    [key: string]: { 
        instrument_token: number; 
        last_price: number; 
        oi?: number; 
        volume?: number; // MODIFIED: Added volume
    }
}
interface LtpQuote {
    [key: string]: { instrument_token: number; last_price: number; }
}
// Your brilliant, robust Instrument type
interface InstrumentWithUnderlying extends Instrument {
  underlying?: any;
}

interface VolumeHistory {
  [symbol: string]: {
    date: string;
    totalVolume: number;
    timestamp: number;
  }[];
}

// Your excellent, safe conversion functions
function convertToNumber(value: any): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value, 10);
  return 0;
}
function convertStrikeToNumber(strike: any): number {
  if (typeof strike === 'number') return strike;
  if (typeof strike === 'string') return parseFloat(strike);
  return 0;
}

// Helper function to check if market is open (for refresh logic)
const isMarketOpen = (): boolean => {
  const now = new Date();
  const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  const hours = istTime.getUTCHours();
  const minutes = istTime.getUTCMinutes();
  const timeInMinutes = hours * 60 + minutes;
  const marketOpenTime = 9 * 60 + 15;
  const marketCloseTime = 15 * 60 + 30;
  
  return timeInMinutes >= marketOpenTime && timeInMinutes <= marketCloseTime;
};

// NEW: Volume history management functions
async function loadVolumeHistory(): Promise<VolumeHistory> {
  try {
    const data = await fs.readFile(volumeHistoryPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

async function saveVolumeHistory(history: VolumeHistory): Promise<void> {
  await fs.writeFile(volumeHistoryPath, JSON.stringify(history, null, 2));
}

async function updateVolumeHistory(symbol: string, totalVolume: number): Promise<void> {
  const history = await loadVolumeHistory();
  const today = new Date().toISOString().split('T')[0];
  const timestamp = Date.now();
  
  if (!history[symbol]) {
    history[symbol] = [];
  }
  
  // Remove old entries (keep only last 20 days)
  const twentyDaysAgo = Date.now() - (20 * 24 * 60 * 60 * 1000);
  history[symbol] = history[symbol].filter(entry => entry.timestamp > twentyDaysAgo);
  
  // Add today's volume if it's a new day or update existing entry
  const todayEntry = history[symbol].find(entry => entry.date === today);
  if (todayEntry) {
    todayEntry.totalVolume = totalVolume;
    todayEntry.timestamp = timestamp;
  } else {
    history[symbol].push({ date: today, totalVolume, timestamp });
  }
  
  await saveVolumeHistory(history);
}

async function calculateVolumeMetrics(symbol: string, todayVolume: number): Promise<{
  avg20DayVolume: number;
  todayVolumePercentage: number;
  estimatedTodayVolume: number;
}> {
  const history = await loadVolumeHistory();
  const symbolHistory = history[symbol] || [];
  
  // Calculate 20-day average (excluding today)
  const historicalData = symbolHistory.filter(entry => entry.date !== new Date().toISOString().split('T')[0]);
  const avg20DayVolume = historicalData.length > 0 
    ? historicalData.reduce((sum, entry) => sum + entry.totalVolume, 0) / historicalData.length
    : 0;
  
  // Calculate percentage of daily average achieved so far
  const todayVolumePercentage = avg20DayVolume > 0 
    ? (todayVolume / avg20DayVolume) * 100 
    : 0;
  
  // Estimate today's full volume based on current market time
  const now = new Date();
  const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  const hours = istTime.getUTCHours();
  const minutes = istTime.getUTCMinutes();
  const currentMinutes = hours * 60 + minutes;
  const marketOpenMinutes = 9 * 60 + 15; // 9:15 AM
  const marketCloseMinutes = 15 * 60 + 30; // 3:30 PM
  
  const minutesPassed = Math.max(0, currentMinutes - marketOpenMinutes);
  const totalMarketMinutes = marketCloseMinutes - marketOpenMinutes;
  const progress = minutesPassed / totalMarketMinutes;
  
  const estimatedTodayVolume = progress > 0 
    ? todayVolume / progress 
    : todayVolume;
  
  return {
    avg20DayVolume: Math.round(avg20DayVolume),
    todayVolumePercentage: parseFloat(todayVolumePercentage.toFixed(1)),
    estimatedTodayVolume: Math.round(estimatedTodayVolume)
  };
}

// --- MAIN API FUNCTION ---
export async function POST(request: Request) {
  try {
    const apiKey = process.env.KITE_API_KEY;
    if (!apiKey) { return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 }); }

    const body = await request.json();
    const { symbol: displayName } = body;
    if (!displayName) { return NextResponse.json({ error: 'Symbol is required' }, { status: 400 }); }

    // --- YOUR SUPERIOR GOOGLE SHEETS LOGIC ---
    const auth = new google.auth.GoogleAuth({ keyFile: path.join(process.cwd(), 'credentials.json'), scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly' });
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: '1NeUJ-N3yNAhtLN0VPV71vY88MTTAYGEW8gGxtNbVcRU', // <--- PASTE YOUR SHEET ID HERE
      range: 'stocks!A2:C',
    });
    const rows = sheetResponse.data.values;
    if (!rows || rows.length === 0) { return NextResponse.json({ error: 'Google Sheet is empty.' }, { status: 500 }); }
    const row = rows.find(r => r[0] === displayName);
    if (!row || !row[1] || !row[2]) { return NextResponse.json({ error: `Incomplete data for '${displayName}' in Google Sheet.` }, { status: 404 }); }
    const ltpSymbol = row[1];
    const underlyingToken = convertToNumber(row[2]);
    if (underlyingToken === 0) { return NextResponse.json({ error: `Invalid token format in sheet: ${row[2]}` }, { status: 400 }); }

    // --- YOUR SUPERIOR KITE LOGIC ---
    const tokenData = JSON.parse(await fs.readFile(tokenPath, 'utf-8'));
    const kc = new KiteConnect({ api_key: apiKey });
    kc.setAccessToken(tokenData.accessToken);

    // --- ENHANCED: FRESH INSTRUMENTS DATA LOGIC ---
    let allInstruments: InstrumentWithUnderlying[];
    
    try {
      // Check if we should use fresh data or cached data
      const marketOpen = isMarketOpen();
      let shouldRefresh = false;

      if (marketOpen) {
        // During market hours, always check if cache is stale
        try {
          const fileStats = await fs.stat(instrumentsPath);
          const fileDate = new Date(fileStats.mtime);
          const now = new Date();
          // Refresh if file is older than 15 minutes during market hours
          shouldRefresh = (now.getTime() - fileDate.getTime()) > (15 * 60 * 1000);
        } catch (error) {
          // File doesn't exist or other error - refresh
          shouldRefresh = true;
        }
      } else {
        // Outside market hours, use cached data if available
        shouldRefresh = false;
      }

      if (shouldRefresh) {
        // Fetch fresh instruments data from Kite API
        allInstruments = await kc.getInstruments();
        // Cache the fresh data
        await fs.writeFile(instrumentsPath, JSON.stringify(allInstruments, null, 2));
      } else {
        // Use cached data
        try {
          allInstruments = JSON.parse(await fs.readFile(instrumentsPath, 'utf-8'));
        } catch (error) {
          // If cache doesn't exist or is invalid, fetch fresh data
          allInstruments = await kc.getInstruments();
          await fs.writeFile(instrumentsPath, JSON.stringify(allInstruments, null, 2));
        }
      }
    } catch (error) {
      console.error('Error fetching instruments:', error);
      // Fallback to cached data if fresh fetch fails
      try {
        allInstruments = JSON.parse(await fs.readFile(instrumentsPath, 'utf-8'));
      } catch {
        return NextResponse.json({ error: 'Could not fetch instruments data' }, { status: 500 });
      }
    }

    const instrumentsWithProperTypes = allInstruments.map(instrument => ({
        ...instrument,
        instrument_token_number: convertToNumber(instrument.instrument_token),
        expiryDate: instrument.expiry ? new Date(instrument.expiry) : null,
        strikeNumber: convertStrikeToNumber(instrument.strike),
        underlying_number: instrument.underlying ? convertToNumber(instrument.underlying) : 0
    }));
    
    const underlyingInstrument = instrumentsWithProperTypes.find(inst => inst.instrument_token_number === underlyingToken);
    if (!underlyingInstrument) { return NextResponse.json({ error: `Could not find instrument with token '${underlyingToken}' for ${displayName}.` }, { status: 404 }); }

    const exchange = (displayName === 'NIFTY' || displayName === 'BANKNIFTY') ? 'NFO' : 'NSE';
    
    // Get underlying instrument LTP and volume data
    const underlyingQuote = await kc.getQuote([`${exchange}:${ltpSymbol}`]);
    const underlyingData = underlyingQuote[`${exchange}:${ltpSymbol}`];
    const ltp = underlyingData?.last_price || 0;
    const underlyingVolume = underlyingData?.volume || 0;
    
    if (ltp === 0) { return NextResponse.json({ error: `Could not fetch live price for '${ltpSymbol}'.` }, { status: 404 }); }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const hasUnderlyingProperty = instrumentsWithProperTypes.some(inst => inst.underlying !== undefined && inst.underlying !== null);
    
    let allOptionsForSymbol;
    if (hasUnderlyingProperty) {
        allOptionsForSymbol = instrumentsWithProperTypes.filter(inst => {
            const isOption = (inst.instrument_type === 'CE' || inst.instrument_type === 'PE');
            const isNotExpired = inst.expiryDate && inst.expiryDate >= today;
            const matchesUnderlyingToken = inst.underlying_number === underlyingToken;
            return isOption && isNotExpired && matchesUnderlyingToken;
        });
    } else {
        const baseTradingSymbol = underlyingInstrument.tradingsymbol;
        allOptionsForSymbol = instrumentsWithProperTypes.filter(inst => {
            const isOption = (inst.instrument_type === 'CE' || inst.instrument_type === 'PE');
            const isNotExpired = inst.expiryDate && inst.expiryDate >= today;
            const matchesTradingSymbol = inst.tradingsymbol && inst.tradingsymbol.startsWith(baseTradingSymbol);
            return isOption && isNotExpired && matchesTradingSymbol;
        });
    }
    
    if (allOptionsForSymbol.length === 0) { return NextResponse.json({ error: `No options found for ${displayName} (token: ${underlyingToken}).` }, { status: 404 }); }
    
    allOptionsForSymbol.sort((a, b) => a.expiryDate!.getTime() - b.expiryDate!.getTime());
    const nearestExpiry = allOptionsForSymbol[0]?.expiryDate;
    if (!nearestExpiry) { return NextResponse.json({ error: `Could not determine expiry for '${displayName}'.` }, { status: 404 }); }
    
    const optionsChain = allOptionsForSymbol.filter(inst => inst.expiryDate!.getTime() === nearestExpiry.getTime());
    const instrumentTokens = optionsChain.map(o => `NFO:${o.tradingsymbol}`);
    const quoteData: QuoteData = await kc.getQuote(instrumentTokens);

    // --- FIXED CALCULATION LOGIC ---
    // MODIFIED: Added volume variables
    let totalCallOI = 0, totalPutOI = 0, highestCallOI = 0, resistance = 0, highestPutOI = 0, support = 0;
    let totalCallVolume = 0, totalPutVolume = 0; // NEW: Added volume totals
    let otmCallOI = 0, otmPutOI = 0;
    const strikePrices: number[] = [];
    const optionsByStrike: Record<number, { ce_oi: number, pe_oi: number }> = {};
    
    for (const opt of optionsChain) {
        const liveData = quoteData[`NFO:${opt.tradingsymbol}`];
        const oi = liveData?.oi || 0;
        const volume = liveData?.volume || 0; // NEW: Get volume data

        if (oi > 0) { // Keep logic based on OI to filter relevant strikes
            const strike = opt.strikeNumber;
            if (!optionsByStrike[strike]) optionsByStrike[strike] = { ce_oi: 0, pe_oi: 0 };
            
            if (opt.instrument_type === 'CE') {
                totalCallOI += oi;
                totalCallVolume += volume; // NEW: Aggregate call volume
                // ONLY COUNT OTM CALLS FOR RESISTANCE (strike > LTP)
                if (strike > ltp) {
                    if (oi > highestCallOI) { 
                        highestCallOI = oi; 
                        resistance = strike; 
                    }
                    otmCallOI += oi;
                }
                optionsByStrike[strike].ce_oi = oi;
            } else if (opt.instrument_type === 'PE') {
                totalPutOI += oi;
                totalPutVolume += volume; // NEW: Aggregate put volume
                // ONLY COUNT OTM PUTS FOR SUPPORT (strike < LTP)
                if (strike < ltp) {
                    if (oi > highestPutOI) { 
                        highestPutOI = oi; 
                        support = strike; 
                    }
                    otmPutOI += oi;
                }
                optionsByStrike[strike].pe_oi = oi;
            }
            if (!strikePrices.includes(strike)) { strikePrices.push(strike); }
        }
    }
    
    if (strikePrices.length === 0) { return NextResponse.json({ error: `Found options but no OI data for ${displayName}.` }, { status: 404 }); }
    strikePrices.sort((a, b) => a - b);
    
    // If no OTM calls found, use nearest OTM strike for resistance
    if (resistance === 0) {
        const otmCalls = strikePrices.filter(strike => strike > ltp);
        if (otmCalls.length > 0) {
            resistance = otmCalls[0]; // Nearest OTM strike
        }
    }
    
    // If no OTM puts found, use nearest OTM strike for support
    if (support === 0) {
        const otmPuts = strikePrices.filter(strike => strike < ltp);
        if (otmPuts.length > 0) {
            support = otmPuts[otmPuts.length - 1]; // Nearest OTM strike
        }
    }
    
    let supportStrength = "Weak";
    if (support > 0) {
        const putsAtSupport = optionsByStrike[support]?.pe_oi || 0;
        const callsAtSupport = optionsByStrike[support]?.ce_oi || 1;
        const ratio = putsAtSupport / callsAtSupport;
        if (ratio > 3) supportStrength = "Very Strong"; else if (ratio > 1.5) supportStrength = "Strong"; else if (ratio > 1) supportStrength = "Moderate";
    }
    
    let resistanceStrength = "Weak";
    if (resistance > 0) {
        const callsAtResistance = optionsByStrike[resistance]?.ce_oi || 0;
        const putsAtResistance = optionsByStrike[resistance]?.pe_oi || 1;
        const ratio = callsAtResistance / putsAtResistance;
        if (ratio > 3) resistanceStrength = "Very Strong"; else if (ratio > 1.5) resistanceStrength = 'Strong'; else if (ratio > 1) resistanceStrength = 'Moderate';
    }
    
    const pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 0;
    const volumePcr = totalCallVolume > 0 ? totalPutVolume / totalCallVolume : 0; // NEW: Calculate Volume PCR

    let minLoss = Infinity, maxPain = 0;
    if (strikePrices.length > 0) {
        for (const expiryStrike of strikePrices) {
            let totalLoss = 0;
            for (const strike of strikePrices) {
                const option = optionsByStrike[strike];
                if (option.ce_oi > 0 && expiryStrike > strike) { totalLoss += (expiryStrike - strike) * option.ce_oi; }
                if (option.pe_oi > 0 && expiryStrike < strike) { totalLoss += (strike - expiryStrike) * option.pe_oi; }
            }
            if (totalLoss < minLoss) { minLoss = totalLoss; maxPain = expiryStrike; }
        }
    }
    
    let sentiment = "Neutral";
    const pcrIsBullish = pcr > 1.1;
    const pcrIsBearish = pcr < 0.9;
    const otmRatio = otmCallOI > 0 ? otmPutOI / otmCallOI : 0;
    if (pcrIsBullish && otmRatio > 1.5) { sentiment = "Strongly Bullish"; } 
    else if (pcrIsBearish && otmRatio < 0.75) { sentiment = "Strongly Bearish"; } 
    else if (pcr > 1.0) { sentiment = "Slightly Bullish"; } 
    else if (pcr < 1.0) { sentiment = "Slightly Bearish"; }
    
    const formattedExpiry = nearestExpiry.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
    
    const lastRefreshed = new Date().toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true
    });

    // NEW: Calculate volume metrics using UNDERLYING volume (not options volume)
    await updateVolumeHistory(displayName, underlyingVolume);
    const volumeMetrics = await calculateVolumeMetrics(displayName, underlyingVolume);
    
    // MODIFIED: Added volume metrics to the response
    const responseData = {
        symbol: displayName.toUpperCase(), 
        pcr: parseFloat(pcr.toFixed(2)), 
        volumePcr: parseFloat(volumePcr.toFixed(2)),
        maxPain, 
        resistance, 
        support, 
        sentiment, 
        expiryDate: formattedExpiry, 
        supportStrength, 
        resistanceStrength,
        ltp: ltp,
        lastRefreshed: lastRefreshed,
        // NEW: Volume metrics (using underlying volume)
        avg20DayVolume: volumeMetrics.avg20DayVolume,
        todayVolumePercentage: volumeMetrics.todayVolumePercentage,
        estimatedTodayVolume: volumeMetrics.estimatedTodayVolume
    };
    
    return NextResponse.json(responseData);

  } catch (error: any) {
    console.error("API Error:", error.message);
    console.error("Error stack:", error.stack);
    if (error.error_type === 'TokenException') {
        return NextResponse.json({ error: 'Kite token has expired. Please run the login script again.' }, { status: 401 });
    }
    return NextResponse.json({ error: 'An error occurred fetching data.' }, { status: 500 });
  }
}