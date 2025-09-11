// This is the final, complete, and unabbreviated code for app/api/analyze/route.ts

import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { KiteConnect, Instrument } from 'kiteconnect';
import { kv } from '@vercel/kv';
import fs from 'fs/promises';
import path from 'path';

const tokenPath = path.join(process.cwd(), 'kite_token.json');

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
      keyFile: path.join(process.cwd(), 'credentials.json'), 
      scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly' 
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: '1NeUJ-N3yNAhtLN0VPV71vY88MTTAYGEW8gGxtNbVcRU', // <--- PASTE YOUR SHEET ID HERE
      range: 'stocks!A2:B',
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
    const tokenData = JSON.parse(await fs.readFile(tokenPath, 'utf-8'));
    const kc = new KiteConnect({ api_key: apiKey });
    kc.setAccessToken(tokenData.accessToken);

    // --- KEY CHANGE: Read the small, pre-filtered cache from the cloud ---
    const optionsCache = await kv.get<{ [key: string]: Instrument[] }>('options_cache');
    if (!optionsCache) {
      return NextResponse.json({ error: 'Options cache is empty. Please run the population script.' }, { status: 500 });
    }

    const optionsChain = optionsCache[tradingSymbol];
    if (!optionsChain || optionsChain.length === 0) {
        return NextResponse.json({ error: `Options data for '${tradingSymbol}' not found in cache.` }, { status: 404 });
    }
    
    const exchange = (displayName === 'NIFTY' || displayName === 'BANKNIFTY') ? 'NFO' : 'NSE';
    const ltpQuote: LtpQuote = await kc.getLTP([`${exchange}:${tradingSymbol}`]);
    const ltp = ltpQuote[`${exchange}:${tradingSymbol}`]?.last_price || 0;
    if (ltp === 0) {
        return NextResponse.json({ error: `Could not fetch live price for '${tradingSymbol}'.` }, { status: 404 });
    }
    
    const instrumentTokens = optionsChain.map(o => `NFO:${o.tradingsymbol}`);
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
        if (ratio > 3) resistanceStrength = "Very Strong"; else if (ratio > 1.5) resistanceStrength = "Strong"; else if (ratio > 1) resistanceStrength = "Moderate";
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
    
    const nearestOption = optionsChain[0];
    const formattedExpiry = new Date(nearestOption.expiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
    const lastRefreshed = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });

    // --- FINAL RESPONSE DATA ---
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