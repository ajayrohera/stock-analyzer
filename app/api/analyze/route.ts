// This is the final and correct code for app/api/analyze/route.ts

import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { KiteConnect, Instrument } from 'kiteconnect';
import fs from 'fs/promises';
import path from 'path';

const tokenPath = path.join(process.cwd(), 'kite_token.json');

// --- HELPER TYPES ---
interface QuoteData {
    [key: string]: { instrument_token: number; last_price: number; oi?: number; }
}
interface LtpQuote {
    [key: string]: { instrument_token: number; last_price: number; }
}

// --- MAIN API FUNCTION ---
export async function POST(request: Request) {
  try {
    const apiKey = process.env.KITE_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Server configuration error: API key is missing.' }, { status: 500 });
    }

    const body = await request.json() as { symbol: string };
    const { symbol: displayName } = body;
    if (!displayName) {
      return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });
    }

    // --- STEP 1: GOOGLE SHEETS LOOKUP ---
    const auth = new google.auth.GoogleAuth({
      keyFile: path.join(process.cwd(), 'credentials.json'),
      scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: 'YOUR_SPREADSHEET_ID', // <--- PASTE YOUR SHEET ID HERE
      range: 'stocks!A2:C',
    });

    const rows = sheetResponse.data.values;
    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: 'Google Sheet is empty or could not be read.' }, { status: 500 });
    }
    const row = rows.find(r => r[0] === displayName);
    if (!row || !row[1] || !row[2]) {
      return NextResponse.json({ error: `Incomplete data for '${displayName}' in Google Sheet.` }, { status: 404 });
    }
    const ltpSymbol = row[1];
    // --- THE FINAL FIX: We keep the token from the sheet as a string. ---
    const underlyingToken = row[2] as string;

    // --- STEP 2: KITE API CALLS ---
    const tokenData = JSON.parse(await fs.readFile(tokenPath, 'utf-8'));
    const kc = new KiteConnect({ api_key: apiKey });
    kc.setAccessToken(tokenData.accessToken);
    
    const allInstruments: Instrument[] = await kc.getInstruments("NFO");
    
    // --- THE FINAL FIX: We convert the token from the library to a string before comparing. ---
    // This is a guaranteed string-to-string comparison.
    const underlyingInstrument = allInstruments.find(inst => String(inst.instrument_token) === underlyingToken);
    
    if (!underlyingInstrument) {
      return NextResponse.json({ error: `Could not find instrument with token '${underlyingToken}' for ${displayName}. Check your sheet.` }, { status: 404 });
    }
    const officialName = underlyingInstrument.name;
    
    const exchange = (displayName === 'NIFTY' || displayName === 'BANKNIFTY') ? 'NFO' : 'NSE';
    const ltpInstrument = `${exchange}:${ltpSymbol}`;
    const ltpQuote: LtpQuote = await kc.getLTP([ltpInstrument]);
    const ltpData = ltpQuote[ltpInstrument];
    const ltp = ltpData?.last_price || 0;
    if (ltp === 0) {
        return NextResponse.json({ error: `Could not fetch live price for '${ltpSymbol}'.` }, { status: 404 });
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const allOptionsForSymbol = allInstruments.filter(inst => inst.name === officialName && (inst.instrument_type === 'CE' || inst.instrument_type === 'PE') && inst.expiry >= today);
    
    if (allOptionsForSymbol.length === 0) { return NextResponse.json({ error: `Live options data for '${officialName}' not found.` }, { status: 404 }); }
    allOptionsForSymbol.sort((a, b) => a.expiry.getTime() - b.expiry.getTime());
    const nearestExpiry = allOptionsForSymbol[0]?.expiry;
    if (!nearestExpiry) { return NextResponse.json({ error: `Could not determine expiry for '${officialName}'.` }, { status: 404 }); }
    const optionsChain = allOptionsForSymbol.filter(inst => inst.expiry.getTime() === nearestExpiry.getTime());
    const instrumentTokens = optionsChain.map(o => `NFO:${o.tradingsymbol}`);
    const quoteData: QuoteData = await kc.getQuote(instrumentTokens);

    // --- CALCULATION LOGIC ---
    let totalCallOI = 0, totalPutOI = 0, highestCallOI = 0, resistance = 0, highestPutOI = 0, support = 0;
    let otmCallOI = 0, otmPutOI = 0;
    const strikePrices: number[] = [];
    const optionsByStrike: Record<number, { ce_oi: number, pe_oi: number }> = {};
    for (const opt of optionsChain) {
        const instrumentKey = `NFO:${opt.tradingsymbol}`;
        const liveData = quoteData[instrumentKey];
        const oi = liveData?.oi || 0;
        if (oi > 0) {
            if (!optionsByStrike[opt.strike]) optionsByStrike[opt.strike] = { ce_oi: 0, pe_oi: 0 };
            if (opt.instrument_type === 'CE') {
                totalCallOI += oi;
                if (oi > highestCallOI) { highestCallOI = oi; resistance = opt.strike; }
                if (opt.strike > ltp) { otmCallOI += oi; }
                optionsByStrike[opt.strike].ce_oi = oi;
            } else if (opt.instrument_type === 'PE') {
                totalPutOI += oi;
                if (oi > highestPutOI) { highestPutOI = oi; support = opt.strike; }
                if (opt.strike < ltp) { otmPutOI += oi; }
                optionsByStrike[opt.strike].pe_oi = oi;
            }
            if (!strikePrices.includes(opt.strike)) { strikePrices.push(opt.strike); }
        }
    }
    strikePrices.sort((a, b) => a - b);
    
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
    const lastRefreshed = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
    
    const responseData = {
      symbol: displayName.toUpperCase(), pcr: parseFloat(pcr.toFixed(2)), maxPain, resistance, support, sentiment, expiryDate: formattedExpiry, supportStrength, resistanceStrength, ltp: ltp, lastRefreshed: lastRefreshed,
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