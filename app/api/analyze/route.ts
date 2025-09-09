// This is the Vercel-compatible version with Redis

import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { KiteConnect, Instrument } from 'kiteconnect';

// Redis client (Vercel compatible)
const redis = {
  get: async (key: string) => {
    const response = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/get/${key}`, {
      headers: {
        Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      },
    });
    const data = await response.json();
    return data.result;
  },
  set: async (key: string, value: any) => {
    const response = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/set/${key}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(value),
    });
    return response.json();
  },
};

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
interface InstrumentWithUnderlying extends Instrument {
  underlying?: any;
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

// Redis-based volume history functions
async function loadVolumeHistory(): Promise<Record<string, any>> {
  try {
    const history = await redis.get('volume_history');
    return history ? JSON.parse(history) : {};
  } catch (error) {
    return {};
  }
}

async function saveVolumeHistory(history: Record<string, any>): Promise<void> {
  await redis.set('volume_history', JSON.stringify(history));
}

async function updateVolumeHistory(symbol: string, totalVolume: number): Promise<void> {
  const history = await loadVolumeHistory();
  const today = new Date().toISOString().split('T')[0];
  const timestamp = Date.now();
  
  if (!history[symbol]) history[symbol] = [];
  
  const twentyDaysAgo = Date.now() - (20 * 24 * 60 * 60 * 1000);
  history[symbol] = history[symbol].filter((entry: any) => entry.timestamp > twentyDaysAgo);
  
  const todayEntry = history[symbol].find((entry: any) => entry.date === today);
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
  
  const historicalData = symbolHistory.filter((entry: any) => entry.date !== new Date().toISOString().split('T')[0]);
  const avg20DayVolume = historicalData.length > 0 
    ? historicalData.reduce((sum: number, entry: any) => sum + entry.totalVolume, 0) / historicalData.length
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

// --- MAIN API FUNCTION ---
export async function POST(request: Request) {
  try {
    const apiKey = process.env.KITE_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });

    const body = await request.json();
    const { symbol: displayName } = body;
    if (!displayName) return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });

    // Google Sheets logic with environment variables
    const auth = new google.auth.GoogleAuth({ 
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      },
      scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly' 
    });
    
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID || '1NeUJ-N3yNAhtLN0VPV71vY88MTTAYGEW8gGxtNbVcRU',
      range: 'stocks!A2:C',
    });
    
    const rows = sheetResponse.data.values;
    if (!rows || rows.length === 0) return NextResponse.json({ error: 'Google Sheet is empty.' }, { status: 500 });
    
    const row = rows.find(r => r[0] === displayName);
    if (!row || !row[1] || !row[2]) return NextResponse.json({ error: `Incomplete data for '${displayName}' in Google Sheet.` }, { status: 404 });
    
    const ltpSymbol = row[1];
    const underlyingToken = convertToNumber(row[2]);
    if (underlyingToken === 0) return NextResponse.json({ error: `Invalid token format in sheet: ${row[2]}` }, { status: 400 });

    // Kite connection with Redis token storage
    let tokenData;
    try {
      const storedToken = await redis.get('kite_token');
      tokenData = storedToken ? JSON.parse(storedToken) : null;
    } catch (error) {
      console.error('Error reading token from Redis:', error);
      return NextResponse.json({ error: 'Token storage error' }, { status: 500 });
    }

    if (!tokenData || !tokenData.accessToken) {
      return NextResponse.json({ error: 'Kite token not found. Please authenticate first.' }, { status: 401 });
    }

    const kc = new KiteConnect({ api_key: apiKey });
    kc.setAccessToken(tokenData.accessToken);

    // Instruments data logic with Redis
    let allInstruments: InstrumentWithUnderlying[];
    try {
      const marketOpen = isMarketOpen();
      let shouldRefresh = false;

      if (marketOpen) {
        try {
          const lastUpdated = await redis.get('instruments_last_updated');
          const lastUpdatedTime = lastUpdated ? parseInt(lastUpdated) : 0;
          shouldRefresh = (Date.now() - lastUpdatedTime) > (15 * 60 * 1000);
        } catch (error) {
          shouldRefresh = true;
        }
      }

      if (shouldRefresh) {
        allInstruments = await kc.getInstruments();
        await redis.set('instruments_data', JSON.stringify(allInstruments));
        await redis.set('instruments_last_updated', Date.now().toString());
      } else {
        try {
          const instrumentsData = await redis.get('instruments_data');
          allInstruments = instrumentsData ? JSON.parse(instrumentsData) : [];
          if (allInstruments.length === 0) {
            allInstruments = await kc.getInstruments();
            await redis.set('instruments_data', JSON.stringify(allInstruments));
          }
        } catch (error) {
          allInstruments = await kc.getInstruments();
          await redis.set('instruments_data', JSON.stringify(allInstruments));
        }
      }
    } catch (error) {
      console.error('Error fetching instruments:', error);
      try {
        const instrumentsData = await redis.get('instruments_data');
        allInstruments = instrumentsData ? JSON.parse(instrumentsData) : [];
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