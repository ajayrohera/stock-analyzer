// This is the updated version with Open Interest analysis

import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { KiteConnect, Instrument } from 'kiteconnect';
import fs from 'fs/promises';
import path from 'path';

const tokenPath = path.join(process.cwd(), 'kite_token.json');
const instrumentsPath = path.join(process.cwd(), 'instruments.json');
const volumeHistoryPath = path.join(process.cwd(), 'volume_history.json');

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
        change?: number; // NEW: Added change field for OI change tracking
    }
}
interface LtpQuote {
    [key: string]: { instrument_token: number; last_price: number; }
}
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

// NEW: Interface for OI history tracking
interface OIHistory {
  [symbol: string]: {
    [strike: string]: {
      ce_oi: number;
      pe_oi: number;
      timestamp: number;
    }[]
  };
}

// Helper functions
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

// Volume history functions
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
  
  if (!history[symbol]) history[symbol] = [];
  
  const twentyDaysAgo = Date.now() - (20 * 24 * 60 * 60 * 1000);
  history[symbol] = history[symbol].filter(entry => entry.timestamp > twentyDaysAgo);
  
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
  
  const historicalData = symbolHistory.filter(entry => entry.date !== new Date().toISOString().split('T')[0]);
  const avg20DayVolume = historicalData.length > 0 
    ? historicalData.reduce((sum, entry) => sum + entry.totalVolume, 0) / historicalData.length
    : 0;
  
  const todayVolumePercentage = avg20DayVolume > 0 
    ? (todayVolume / avg20DayVolume) * 100 
    : 0;
  
  const now = new Date();
  const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  const hours = istTime.getUTCHours();
  const minutes = istTime.getUTCMinutes();
  const currentMinutes = hours * 60 + minutes;
  const marketOpenMinutes = 9 * 60 + 15;
  const marketCloseMinutes = 15 * 60 + 30;
  
  const minutesPassed = Math.max(0, currentMinutes - marketOpenMinutes);
  const totalMarketMinutes = marketCloseMinutes - marketOpenMinutes;
  const progress = minutesPassed / totalMarketMinutes;
  
  const estimatedTodayVolume = progress > 0 ? todayVolume / progress : todayVolume;
  
  return {
    avg20DayVolume: Math.round(avg20DayVolume),
    todayVolumePercentage: parseFloat(todayVolumePercentage.toFixed(1)),
    estimatedTodayVolume: Math.round(estimatedTodayVolume)
  };
}

// NEW: OI History functions
async function loadOIHistory(): Promise<OIHistory> {
  try {
    const data = await fs.readFile(path.join(process.cwd(), 'oi_history.json'), 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

async function saveOIHistory(history: OIHistory): Promise<void> {
  await fs.writeFile(path.join(process.cwd(), 'oi_history.json'), JSON.stringify(history, null, 2));
}

async function updateOIHistory(symbol: string, strike: number, ce_oi: number, pe_oi: number): Promise<void> {
  const history = await loadOIHistory();
  const timestamp = Date.now();
  
  if (!history[symbol]) history[symbol] = {};
  if (!history[symbol][strike]) history[symbol][strike] = [];
  
  // Keep only the last 5 readings (about 15-30 minutes of data)
  if (history[symbol][strike].length >= 5) {
    history[symbol][strike].shift();
  }
  
  history[symbol][strike].push({ ce_oi, pe_oi, timestamp });
  await saveOIHistory(history);
}

async function calculateOIChanges(symbol: string, currentOIByStrike: Record<number, { ce_oi: number, pe_oi: number }>): Promise<{
  calls: Array<{ strike: number; changeOi: number; totalOi: number; type: 'CALL' }>;
  puts: Array<{ strike: number; changeOi: number; totalOi: number; type: 'PUT' }>;
  summary: string;
}> {
  const history = await loadOIHistory();
  const symbolHistory = history[symbol] || {};
  
  const callChanges: Array<{ strike: number; changeOi: number; totalOi: number; type: 'CALL' }> = [];
  const putChanges: Array<{ strike: number; changeOi: number; totalOi: number; type: 'PUT' }> = [];
  
  // Calculate changes for each strike
  for (const [strikeStr, currentData] of Object.entries(currentOIByStrike)) {
    const strike = parseInt(strikeStr);
    const historicalReadings = symbolHistory[strike] || [];
    
    if (historicalReadings.length > 0) {
      const previousReading = historicalReadings[historicalReadings.length - 1];
      const ceChange = currentData.ce_oi - previousReading.ce_oi;
      const peChange = currentData.pe_oi - previousReading.pe_oi;
      
      if (ceChange !== 0) {
        callChanges.push({
          strike,
          changeOi: ceChange,
          totalOi: currentData.ce_oi,
          type: 'CALL'
        });
      }
      
      if (peChange !== 0) {
        putChanges.push({
          strike,
          changeOi: peChange,
          totalOi: currentData.pe_oi,
          type: 'PUT'
        });
      }
      
      // Update history with current data
      await updateOIHistory(symbol, strike, currentData.ce_oi, currentData.pe_oi);
    } else {
      // First time seeing this strike, initialize history
      await updateOIHistory(symbol, strike, currentData.ce_oi, currentData.pe_oi);
    }
  }
  
  // Sort by absolute change and take top 5
  callChanges.sort((a, b) => Math.abs(b.changeOi) - Math.abs(a.changeOi));
  putChanges.sort((a, b) => Math.abs(b.changeOi) - Math.abs(a.changeOi));
  
  const topCallChanges = callChanges.slice(0, 5);
  const topPutChanges = putChanges.slice(0, 5);
  
  // Generate summary
  let summary = "No significant OI changes detected.";
  
  if (topCallChanges.length > 0 || topPutChanges.length > 0) {
    const callIncrease = topCallChanges.filter(c => c.changeOi > 0).length;
    const callDecrease = topCallChanges.filter(c => c.changeOi < 0).length;
    const putIncrease = topPutChanges.filter(p => p.changeOi > 0).length;
    const putDecrease = topPutChanges.filter(p => p.changeOi < 0).length;
    
    if (callIncrease > putIncrease && callDecrease < putDecrease) {
      summary = "Bullish bias: Call buying and Put unwinding detected.";
    } else if (putIncrease > callIncrease && putDecrease < callDecrease) {
      summary = "Bearish bias: Put buying and Call unwinding detected.";
    } else if (callIncrease > 0 && putIncrease > 0) {
      summary = "Mixed activity: Both Call and Put buying detected.";
    } else if (callDecrease > 0 && putDecrease > 0) {
      summary = "Unwinding: Both Call and Put positions being closed.";
    }
  }
  
  return {
    calls: topCallChanges,
    puts: topPutChanges,
    summary
  };
}

// --- MAIN API FUNCTION ---
export async function POST(request: Request) {
  try {
    const apiKey = process.env.KITE_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });

    const body = await request.json();
    const { symbol: displayName } = body;
    if (!displayName) return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });

    // Google Sheets logic
    const auth = new google.auth.GoogleAuth({ 
      keyFile: path.join(process.cwd(), 'credentials.json'), 
      scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly' 
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: '1NeUJ-N3yNAhtLN0VPV71vY88MTTAYGEW8gGxtNbVcRU',
      range: 'stocks!A2:C',
    });
    
    const rows = sheetResponse.data.values;
    if (!rows || rows.length === 0) return NextResponse.json({ error: 'Google Sheet is empty.' }, { status: 500 });
    
    const row = rows.find(r => r[0] === displayName);
    if (!row || !row[1] || !row[2]) return NextResponse.json({ error: `Incomplete data for '${displayName}' in Google Sheet.` }, { status: 404 });
    
    const ltpSymbol = row[1];
    const underlyingToken = convertToNumber(row[2]);
    if (underlyingToken === 0) return NextResponse.json({ error: `Invalid token format in sheet: ${row[2]}` }, { status: 400 });

    // Kite connection
    const tokenData = JSON.parse(await fs.readFile(tokenPath, 'utf-8'));
    const kc = new KiteConnect({ api_key: apiKey });
    kc.setAccessToken(tokenData.accessToken);

    // Instruments data logic
    let allInstruments: InstrumentWithUnderlying[];
    try {
      const marketOpen = isMarketOpen();
      let shouldRefresh = false;

      if (marketOpen) {
        try {
          const fileStats = await fs.stat(instrumentsPath);
          const fileDate = new Date(fileStats.mtime);
          const now = new Date();
          shouldRefresh = (now.getTime() - fileDate.getTime()) > (15 * 60 * 1000);
        } catch (error) {
          shouldRefresh = true;
        }
      }

      if (shouldRefresh) {
        allInstruments = await kc.getInstruments();
        await fs.writeFile(instrumentsPath, JSON.stringify(allInstruments, null, 2));
      } else {
        try {
          allInstruments = JSON.parse(await fs.readFile(instrumentsPath, 'utf-8'));
        } catch (error) {
          allInstruments = await kc.getInstruments();
          await fs.writeFile(instrumentsPath, JSON.stringify(allInstruments, null, 2));
        }
      }
    } catch (error) {
      console.error('Error fetching instruments:', error);
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
    if (!underlyingInstrument) return NextResponse.json({ error: `Could not find instrument with token '${underlyingToken}' for ${displayName}.` }, { status: 404 });

    const exchange = (displayName === 'NIFTY' || displayName === 'BANKNIFTY') ? 'NFO' : 'NSE';
    
    // Get underlying instrument data
    const underlyingQuote = await kc.getQuote([`${exchange}:${ltpSymbol}`]);
    const underlyingData = underlyingQuote[`${exchange}:${ltpSymbol}`];
    const ltp = underlyingData?.last_price || 0;
    const underlyingVolume = underlyingData?.volume || 0;
    
    if (ltp === 0) return NextResponse.json({ error: `Could not fetch live price for '${ltpSymbol}'.` }, { status: 404 });

    // Calculate percentage change
    let changePercent = 0;
    try {
      if (underlyingData?.ohlc?.close && underlyingData.ohlc.close > 0) {
        changePercent = ((ltp - underlyingData.ohlc.close) / underlyingData.ohlc.close) * 100;
      }
    } catch (error) {
      console.error('Error calculating percentage change:', error);
    }

    // Options chain processing
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
    
    if (allOptionsForSymbol.length === 0) return NextResponse.json({ error: `No options found for ${displayName} (token: ${underlyingToken}).` }, { status: 404 });
    
    allOptionsForSymbol.sort((a, b) => a.expiryDate!.getTime() - b.expiryDate!.getTime());
    const nearestExpiry = allOptionsForSymbol[0]?.expiryDate;
    if (!nearestExpiry) return NextResponse.json({ error: `Could not determine expiry for '${displayName}'.` }, { status: 404 });
    
    const optionsChain = allOptionsForSymbol.filter(inst => inst.expiryDate!.getTime() === nearestExpiry.getTime());
    const instrumentTokens = optionsChain.map(o => `NFO:${o.tradingsymbol}`);
    const quoteData: QuoteData = await kc.getQuote(instrumentTokens);

    // Calculate OI and volume data
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
            const strike = opt.strikeNumber;
            if (!optionsByStrike[strike]) optionsByStrike[strike] = { ce_oi: 0, pe_oi: 0 };
            
            if (opt.instrument_type === 'CE') {
                totalCallOI += oi;
                totalCallVolume += volume;
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
                totalPutVolume += volume;
                if (strike < ltp) {
                    if (oi > highestPutOI) { 
                        highestPutOI = oi; 
                        support = strike; 
                    }
                    otmPutOI += oi;
                }
                optionsByStrike[strike].pe_oi = oi;
            }
            if (!strikePrices.includes(strike)) strikePrices.push(strike);
        }
    }
    
    if (strikePrices.length === 0) return NextResponse.json({ error: `Found options but no OI data for ${displayName}.` }, { status: 404 });
    strikePrices.sort((a, b) => a - b);
    
    if (resistance === 0) {
        const otmCalls = strikePrices.filter(strike => strike > ltp);
        if (otmCalls.length > 0) resistance = otmCalls[0];
    }
    
    if (support === 0) {
        const otmPuts = strikePrices.filter(strike => strike < ltp);
        if (otmPuts.length > 0) support = otmPuts[otmPuts.length - 1];
    }
    
    let supportStrength = "Weak";
    if (support > 0) {
        const putsAtSupport = optionsByStrike[support]?.pe_oi || 0;
        const callsAtSupport = optionsByStrike[support]?.ce_oi || 1;
        const ratio = putsAtSupport / callsAtSupport;
        if (ratio > 3) supportStrength = "Very Strong";
        else if (ratio > 1.5) supportStrength = "Strong";
        else if (ratio > 1) supportStrength = "Moderate";
    }
    
    let resistanceStrength = "Weak";
    if (resistance > 0) {
        const callsAtResistance = optionsByStrike[resistance]?.ce_oi || 0;
        const putsAtResistance = optionsByStrike[resistance]?.pe_oi || 1;
        const ratio = callsAtResistance / putsAtResistance;
        if (ratio > 3) resistanceStrength = "Very Strong";
        else if (ratio > 1.5) resistanceStrength = "Strong";
        else if (ratio > 1) resistanceStrength = "Moderate";
    }
    
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
    
    let sentiment = "Neutral";
    const pcrIsBullish = pcr > 1.1;
    const pcrIsBearish = pcr < 0.9;
    const otmRatio = otmCallOI > 0 ? otmPutOI / otmCallOI : 0;
    if (pcrIsBullish && otmRatio > 1.5) sentiment = "Strongly Bullish";
    else if (pcrIsBearish && otmRatio < 0.75) sentiment = "Strongly Bearish";
    else if (pcr > 1.0) sentiment = "Slightly Bullish";
    else if (pcr < 1.0) sentiment = "Slightly Bearish";
    
    const formattedExpiry = nearestExpiry.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
    const lastRefreshed = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });

    // Calculate volume metrics
    await updateVolumeHistory(displayName, underlyingVolume);
    const volumeMetrics = await calculateVolumeMetrics(displayName, underlyingVolume);
    
    // NEW: Calculate OI changes
    const oiAnalysis = await calculateOIChanges(displayName, optionsByStrike);
    
    // Response data
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
        changePercent: parseFloat(changePercent.toFixed(2)),
        avg20DayVolume: volumeMetrics.avg20DayVolume,
        todayVolumePercentage: volumeMetrics.todayVolumePercentage,
        estimatedTodayVolume: volumeMetrics.estimatedTodayVolume,
        // NEW: OI Analysis data
        oiAnalysis
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