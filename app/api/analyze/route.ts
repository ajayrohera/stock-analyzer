import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { KiteConnect } from 'kiteconnect';
import { createClient } from 'redis';
import { generateADAnalysis, ADAnalysis } from '@/utils/ad-analysis';

// --- HELPER TYPES ---
interface QuoteData {
    [key:string]: { 
        instrument_token: number; 
        last_price: number; 
        oi?: number; 
        volume?: number;
        ohlc?: { open: number; high: number; low: number; close: number; };
    }
}
interface LtpQuote {
    [key:string]: { instrument_token: number; last_price: number; }
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
  high?: number; 
  low?: number; 
  close?: number; 
  name?: string;
}
interface SupportResistanceLevel {
  price: number;
  strength: 'weak' | 'medium' | 'strong';
  type: 'support' | 'resistance';
  tooltip?: string;
}

// ADDED: Enhanced Support/Resistance Level with OI Trend
interface EnhancedSupportResistanceLevel extends SupportResistanceLevel {
  oiTrend?: {
    direction: 'BUILDING' | 'DECLINING' | 'STABLE';
    changePercent: number;
    significance: 'LOW' | 'MEDIUM' | 'HIGH';
    icon: string;
  };
  currentOI?: {
    ce_oi: number;
    pe_oi: number;
  };
  displayStrength?: string; // Added for formatted display with arrow
}

// ADDED: VWAP Interface
interface VWAPAnalysis {
  value: number | null;
  typicalPrice: number;
  cumulativeVolume: number;
  deviationPercent: number;
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  strength: 'STRONG' | 'MODERATE' | 'WEAK';
  interpretation: string;
}

const specialPsychologicalLevels: Record<string, number[]> = {
  'NIFTY': [24000, 24500, 25000, 25500, 26000],
  'BANKNIFTY': [52000, 53000, 54000, 55000, 56000],
  'RELIANCE': [2400, 2500, 2600, 2700, 2800, 2900, 3000],
};

async function getRedisData(key: string): Promise<string | null> {
  const client = createClient({ url: process.env.REDIS_URL });
  try {
    await client.connect();
    const data = await client.get(key);
    console.log(`🔍 REDIS DEBUG: Key "${key}" ${data ? 'FOUND' : 'NOT FOUND'}`);
    return data;
  } catch (error) {
    console.error(`❌ REDIS ERROR: Failed to get key "${key}":`, error);
    return null;
  } finally {
    await client.quit().catch(err => console.error('Redis quit error:', err));
  }
}

// --- FIX: cache the NFO instrument list for 24 hours instead of
// re-downloading Kite's entire options universe (tens of thousands of
// rows) on EVERY single analysis. This is purely a metadata list (which
// contracts exist — symbol/strike/expiry/token), NOT live price data, so
// caching it has zero effect on data freshness. Kite's own docs recommend
// fetching this once a day, not per-request. Re-fetching it repeatedly
// was also likely contributing to intermittent rate-limit-style failures
// (like the "Live price fetch failed: Unknown error" seen on ANGELONE),
// since it fires immediately before the live getQuote() call each time.
const INSTRUMENTS_CACHE_KEY = 'nfo_instruments_cache';
const INSTRUMENTS_CACHE_TTL_SECONDS = 24 * 60 * 60; // 24 hours

async function getCachedInstruments(kc: any): Promise<any[]> {
  const cached = await getRedisData(INSTRUMENTS_CACHE_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      console.log(`📋 Using cached NFO instruments (${parsed.length} instruments)`);
      return parsed;
    } catch (e) {
      console.error('❌ Failed to parse cached instruments, will re-fetch:', e);
    }
  }

  console.log('📋 No valid cache — fetching fresh instrument list from Kite...');
  const fresh = await kc.getInstruments('NFO');

  const client = createClient({ url: process.env.REDIS_URL });
  try {
    await client.connect();
    await client.set(INSTRUMENTS_CACHE_KEY, JSON.stringify(fresh), { EX: INSTRUMENTS_CACHE_TTL_SECONDS });
    console.log(`💾 Cached ${fresh.length} NFO instruments for ${INSTRUMENTS_CACHE_TTL_SECONDS / 3600}h`);
  } catch (error) {
    console.error('❌ Error caching instruments (continuing anyway):', error);
  } finally {
    await client.quit().catch(err => console.error('Redis quit error:', err));
  }

  return fresh;
}

// ADDED: Store OI data in Redis
async function storeOIData(symbol: string, optionsByStrike: Record<number, { ce_oi: number, pe_oi: number }>): Promise<void> {
  const client = createClient({ url: process.env.REDIS_URL });
  try {
    await client.connect();
    
    const oiHistoryKey = `oi_history_${symbol.toUpperCase()}`;
    const timestamp = new Date().toISOString();
    
    // Get existing OI history
    const existingData = await client.get(oiHistoryKey);
    const oiHistory = existingData ? JSON.parse(existingData) : {};
    
    // Add new OI data with timestamp
    oiHistory[timestamp] = {};
    
    for (const [strike, oiData] of Object.entries(optionsByStrike)) {
      oiHistory[timestamp][strike] = {
        ce_oi: oiData.ce_oi,
        pe_oi: oiData.pe_oi
      };
    }
    
    // Keep only last 30 days of data to prevent Redis from growing too large
    const timestamps = Object.keys(oiHistory).sort();
    if (timestamps.length > 30) {
      const oldestTimestamps = timestamps.slice(0, timestamps.length - 30);
      oldestTimestamps.forEach(oldTimestamp => {
        delete oiHistory[oldTimestamp];
      });
    }
    
    await client.set(oiHistoryKey, JSON.stringify(oiHistory), { EX: 2592000 }); // 30 days expiry
    console.log(`💾 OI data stored for ${symbol} with ${Object.keys(oiHistory).length} timestamps`);
  } catch (error) {
    console.error('❌ Error storing OI data:', error);
  } finally {
    await client.quit().catch(err => console.error('Redis quit error:', err));
  }
}

// ADDED: Store VWAP data in Redis
async function storeVWAPData(symbol: string, vwapData: any): Promise<void> {
  const client = createClient({ url: process.env.REDIS_URL });
  try {
    await client.connect();
    const key = `vwap_data_${symbol.toUpperCase()}`;
    await client.set(key, JSON.stringify(vwapData), { EX: 86400 });
    console.log(`💾 VWAP data stored for ${symbol}`);
  } catch (error) {
    console.error('❌ Error storing VWAP data:', error);
  } finally {
    await client.quit().catch(err => console.error('Redis quit error:', err));
  }
}

// ADDED: Get VWAP data from Redis
async function getVWAPData(symbol: string): Promise<any> {
  const client = createClient({ url: process.env.REDIS_URL });
  try {
    await client.connect();
    const key = `vwap_data_${symbol.toUpperCase()}`;
    const data = await client.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('❌ Error getting VWAP data:', error);
    return null;
  } finally {
    await client.quit().catch(err => console.error('Redis quit error:', err));
  }
}

// ADDED: VWAP Calculation Function
function calculateVWAP(
  currentPrice: number, 
  currentVolume: number, 
  historicalData: HistoricalData[], 
  todayOHLC: { open: number; high: number; low: number; close: number } | null,
  isMarketOpen: boolean,
  istHours: number,
  istMinutes: number
): VWAPAnalysis {
  console.log('📊 VWAP CALCULATION STARTED =================');
  
  try {
    const isIndex = ['NIFTY', 'BANKNIFTY'].includes(historicalData.length > 0 ? historicalData[0].name || '' : '');

    if (isIndex) {
      console.log('📊 VWAP: Index instrument detected, using simplified calculation');
      return {
        value: currentPrice * 0.998,
        typicalPrice: currentPrice,
        cumulativeVolume: currentVolume,
        deviationPercent: 0.2,
        signal: 'NEUTRAL',
        strength: 'WEAK',
        interpretation: 'VWAP for indices is indicative due to volume limitations'
      };
    }

    let cumulativeTypicalPriceVolume = 0;
    let cumulativeVolume = 0;
    let vwapValue: number | null = null;

    const typicalPrice = todayOHLC ? 
      (todayOHLC.high + todayOHLC.low + currentPrice) / 3 : 
      currentPrice;

    console.log('📊 VWAP CALCULATION:', {
      currentPrice,
      typicalPrice,
      currentVolume,
      hasOHLC: !!todayOHLC,
      marketOpen: isMarketOpen
    });

    if (isMarketOpen && currentVolume > 0) {
      const marketProgress = ((istHours - 9) * 60 + (istMinutes - 15)) / (6 * 60 + 15);
      const estimatedSessionVolume = currentVolume / Math.max(marketProgress, 0.1);
      
      cumulativeTypicalPriceVolume = typicalPrice * estimatedSessionVolume * 0.3;
      cumulativeVolume = estimatedSessionVolume * 0.3;
      
      vwapValue = cumulativeVolume > 0 ? cumulativeTypicalPriceVolume / cumulativeVolume : currentPrice;
      
      console.log('📊 PROGRESSIVE VWAP:', {
        marketProgress: (marketProgress * 100).toFixed(1) + '%',
        estimatedSessionVolume,
        vwapValue,
        cumulativeVolume
      });
    } else {
      if (historicalData.length > 0) {
        const recentData = historicalData.slice(-5);
        let totalVWAP = 0;
        let count = 0;
        
        for (const day of recentData) {
          if (day.lastPrice && day.totalVolume) {
            totalVWAP += day.lastPrice;
            count++;
          }
        }
        
        vwapValue = count > 0 ? totalVWAP / count : currentPrice;
        console.log('📊 HISTORICAL VWAP APPROXIMATION:', { vwapValue, daysUsed: count });
      } else {
        vwapValue = currentPrice;
        console.log('📊 FALLBACK VWAP: Using current price');
      }
    }

    const deviationPercent = vwapValue ? ((currentPrice - vwapValue) / vwapValue) * 100 : 0;

    let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let strength: 'STRONG' | 'MODERATE' | 'WEAK' = 'WEAK';
    let interpretation = '';

    if (deviationPercent > 1.0) {
      signal = 'BULLISH';
      strength = deviationPercent > 2.0 ? 'STRONG' : 'MODERATE';
      interpretation = `Trading ${deviationPercent.toFixed(2)}% above VWAP - bullish intraday bias`;
    } else if (deviationPercent < -1.0) {
      signal = 'BEARISH';
      strength = deviationPercent < -2.0 ? 'STRONG' : 'MODERATE';
      interpretation = `Trading ${Math.abs(deviationPercent).toFixed(2)}% below VWAP - bearish intraday bias`;
    } else {
      signal = 'NEUTRAL';
      strength = 'WEAK';
      interpretation = 'Trading near VWAP - neutral intraday bias';
    }

    console.log('📊 VWAP RESULT:', {
      vwapValue,
      currentPrice,
      deviationPercent: deviationPercent.toFixed(2) + '%',
      signal,
      strength,
      cumulativeVolume
    });

    return {
      value: vwapValue,
      typicalPrice,
      cumulativeVolume,
      deviationPercent,
      signal,
      strength,
      interpretation
    };

  } catch (error) {
    console.error('❌ VWAP CALCULATION ERROR:', error);
    return {
      value: currentPrice,
      typicalPrice: currentPrice,
      cumulativeVolume: currentVolume,
      deviationPercent: 0,
      signal: 'NEUTRAL',
      strength: 'WEAK',
      interpretation: 'VWAP calculation failed - using current price as fallback'
    };
  }
}

// --- MARKET CALENDAR HELPER FUNCTIONS ---
async function checkIfMarketHoliday(date: Date): Promise<boolean> {
  try {
    console.log('📅 Checking market holiday for:', date.toISOString().split('T')[0]);
    
    const holidayData = await getRedisData('market_holidays');
    if (holidayData) {
      const holidays: string[] = JSON.parse(holidayData);
      const dateStr = date.toISOString().split('T')[0];
      const isHoliday = holidays.includes(dateStr);
      console.log(`📅 Holiday check: ${dateStr} - ${isHoliday ? 'HOLIDAY' : 'TRADING DAY'}`);
      return isHoliday;
    }
    
    const majorHolidays = [
      '2025-01-26', '2025-03-29', '2025-04-14', '2025-04-17', '2025-05-01',
      '2025-06-17', '2025-07-17', '2025-08-15', '2025-10-02', '2025-11-14',
      '2025-12-25'
    ];
    const dateStr = date.toISOString().split('T')[0];
    const isHoliday = majorHolidays.includes(dateStr);
    console.log(`📅 Fallback holiday check: ${dateStr} - ${isHoliday ? 'HOLIDAY' : 'TRADING DAY'}`);
    return isHoliday;
  } catch (error) {
    console.error('❌ Error checking market holiday:', error);
    return false;
  }
}

// --- FIX: getWeekendVolumePCR, getHolidayVolumePCR, and getAfterHoursVolumePCR
// used to live here. All three used Math.random() to fabricate a
// plausible-looking PCR value whenever real weekend/holiday/after-hours
// volume data wasn't available, and fed that synthetic number into the
// same sentiment score as genuinely live data — with no way for the user
// to tell the difference. They also depended on two Redis keys
// ('friday_closing_data', 'pre_holiday_data') that were never written
// anywhere in the codebase, so the "use real data first" branch could
// never actually succeed — the random fallback fired 100% of the time.
//
// Replaced by a single honest rule at the call site below: use the
// genuinely real, exchange-published OI-based `pcr` as a proxy for
// `volumePcr` whenever live trading volume isn't available (which is
// correct in ALL of these situations, not just "market open"), and
// explicitly flag the result as estimated rather than inventing a number
// when even that isn't usable.

function calculatePriceTrend(historicalData: HistoricalData[]): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  try {
    if (historicalData.length < 2) {
      console.log('📊 PRICE TREND: Insufficient data for trend analysis');
      return 'NEUTRAL';
    }
    
    const prices = historicalData.map(d => d.lastPrice).filter((p): p is number => p !== undefined && p > 0);
    if (prices.length < 2) {
      console.log('📊 PRICE TREND: No valid price data for trend analysis');
      return 'NEUTRAL';
    }
    
    const firstPrice = prices[0];
    const lastPrice = prices[prices.length - 1];
    const changePercent = ((lastPrice - firstPrice) / firstPrice) * 100;
    
    let trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    if (changePercent > 2) trend = 'BULLISH';
    else if (changePercent < -2) trend = 'BEARISH';
    
    console.log(`📊 PRICE TREND: ${changePercent.toFixed(2)}% change → ${trend}`);
    return trend;
  } catch (error) {
    console.error('❌ Error calculating price trend:', error);
    return 'NEUTRAL';
  }
}

function getTrendBasedPCR(trend: string): number {
  const pcr = trend === 'BULLISH' ? 0.8 : trend === 'BEARISH' ? 1.2 : 1.0;
  console.log(`📊 TREND-BASED PCR: ${trend} trend → PCR: ${pcr}`);
  return pcr;
}

// --- HELPER FUNCTIONS ---

// ADDED: RSI Calculation Function
function calculateRSI(historicalData: HistoricalData[], period: number = 14): { value: number | null; signal: string; strength: string; interpretation: string } {
  console.log(`📊 RSI Calculation starting with ${historicalData.length} days of data, period: ${period}`);
  
  if (historicalData.length < period + 1) {
    console.log(`❌ Insufficient data for RSI. Need ${period + 1} days, have ${historicalData.length}`);
    return {
      value: 50,
      signal: 'NEUTRAL',
      strength: 'LOW',
      interpretation: `Using neutral RSI (50) - need ${period + 1} days for accurate calculation`
    };
  }

  try {
    const sortedData = [...historicalData].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    let gains: number[] = [];
    let losses: number[] = [];

    for (let i = 1; i < sortedData.length; i++) {
      const currentPrice = sortedData[i].lastPrice || 0;
      const previousPrice = sortedData[i - 1].lastPrice || 0;
      
      if (currentPrice > 0 && previousPrice > 0) {
        const change = currentPrice - previousPrice;
        gains.push(change > 0 ? change : 0);
        losses.push(change < 0 ? Math.abs(change) : 0);
      }
    }

    let avgGain = gains.slice(0, period).reduce((sum, gain) => sum + gain, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((sum, loss) => sum + loss, 0) / period;

    for (let i = period; i < gains.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }

    if (avgLoss === 0) {
      const rsiValue = avgGain > 0 ? 100 : 50;
      console.log(`📊 RSI Calculation: No losses detected, RSI: ${rsiValue}`);
      return {
        value: rsiValue,
        signal: rsiValue >= 70 ? 'OVERBOUGHT' : rsiValue <= 30 ? 'OVERSOLD' : 'NEUTRAL',
        strength: 'MEDIUM',
        interpretation: avgGain > 0 ? 'Consistent gains with no losses' : 'No price movement detected'
      };
    }

    const rs = avgGain / avgLoss;
    const rsiValue = 100 - (100 / (1 + rs));
    const roundedRSI = Math.round(rsiValue * 100) / 100;

    let signal = 'NEUTRAL';
    let strength = 'NEUTRAL';
    let interpretation = '';

    if (roundedRSI >= 70) {
      signal = 'OVERBOUGHT';
      strength = roundedRSI >= 80 ? 'STRONG' : roundedRSI >= 75 ? 'MODERATE' : 'WEAK';
      interpretation = `RSI indicates overbought conditions. Potential pullback expected.`;
    } else if (roundedRSI <= 30) {
      signal = 'OVERSOLD';
      strength = roundedRSI <= 20 ? 'STRONG' : roundedRSI <= 25 ? 'MODERATE' : 'WEAK';
      interpretation = `RSI indicates oversold conditions. Potential buying opportunity.`;
    } else if (roundedRSI > 50) {
      signal = 'BULLISH';
      strength = 'NEUTRAL';
      interpretation = `RSI in bullish territory but not overbought.`;
    } else {
      signal = 'BEARISH';
      strength = 'NEUTRAL';
      interpretation = `RSI in bearish territory but not oversold.`;
    }

    console.log(`📊 RSI Calculation result: ${roundedRSI}, Signal: ${signal}, Strength: ${strength}`);
    
    return {
      value: roundedRSI,
      signal,
      strength,
      interpretation
    };
  } catch (error) {
    console.error('❌ RSI Calculation error:', error);
    return {
      value: 50,
      signal: 'NEUTRAL',
      strength: 'LOW',
      interpretation: 'Error calculating RSI - using neutral default'
    };
  }
}

async function getHistoricalData(symbol: string): Promise<HistoricalData[]> {
  try {
    console.log(`📊 HISTORICAL DATA: Fetching for ${symbol}`);
    const historyData = await getRedisData('volume_history');
    if (!historyData) {
      console.log('❌ No volume_history data found in Redis');
      return [];
    }
    
    const history: Record<string, HistoricalData[]> = JSON.parse(historyData);
    const symbolData = history[symbol.toUpperCase()] || [];
    
    console.log(`📊 Historical data for ${symbol}:`, {
      found: symbolData.length > 0,
      entries: symbolData.length,
      latest: symbolData.length > 0 ? symbolData[symbolData.length - 1] : null
    });
    
    return symbolData;
  } catch (error) { 
    console.error('❌ Error in getHistoricalData:', error); 
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
  if (specialPsychologicalLevels[upperSymbol]) {
    console.log(`🧠 PSYCHOLOGICAL LEVELS: Using special levels for ${symbol}`);
    return specialPsychologicalLevels[upperSymbol];
  }
  const generatedLevels = generatePsychologicalLevels(currentPrice);
  console.log(`🧠 PSYCHOLOGICAL LEVELS: Generated ${generatedLevels.length} levels for ${symbol}`);
  return generatedLevels;
}

// FIXED: Change percent calculation using Zerodha's actual previous close
async function calculateChangePercent(
  currentPrice: number, 
  historicalData: HistoricalData[], 
  priceType: string,
  kite?: any,
  tradingSymbol?: string,
  exchange?: string
): Promise<number> {
  console.log(`📈 Calculating change percent for: ${tradingSymbol}, Current: ${currentPrice}`);
  
  if (!currentPrice || currentPrice <= 0) {
    console.log('⚠️ Invalid current price for change calculation');
    return 0;
  }
  
  // Try to get previous close from Zerodha quote data first
  if (kite && tradingSymbol && exchange) {
    try {
      console.log('🔍 Attempting to fetch previous close from Zerodha...');
      const quoteData = await kite.getQuote([`${exchange}:${tradingSymbol}`]);
      const instrumentData = quoteData[`${exchange}:${tradingSymbol}`];
      
      if (instrumentData && instrumentData.ohlc && instrumentData.ohlc.close > 0) {
        const previousClose = instrumentData.ohlc.close;
        const changePercent = ((currentPrice - previousClose) / previousClose) * 100;
        
        console.log(`📊 Zerodha-based change: ${currentPrice} vs ${previousClose} = ${changePercent.toFixed(2)}%`);
        return changePercent;
      }
    } catch (error) {
      console.log('⚠️ Failed to fetch from Zerodha, falling back to historical data:', error);
    }
  }
  
  // Fallback to historical data calculation
  if (!historicalData || historicalData.length === 0) {
    console.log('⚠️ No historical data available for change calculation');
    return 0;
  }
  
  // Sort by date (newest first) and find most recent valid price
  const sortedHistorical = [...historicalData].sort((a, b) => 
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  
  for (const dayData of sortedHistorical) {
    if (dayData.lastPrice && dayData.lastPrice > 0) {
      const changePercent = ((currentPrice - dayData.lastPrice) / dayData.lastPrice) * 100;
      console.log(`📊 Historical-based change: ${currentPrice} vs ${dayData.lastPrice} (${dayData.date}) = ${changePercent.toFixed(2)}%`);
      return changePercent;
    }
  }
  
  console.log('📊 No valid reference price found');
  return 0;
}

// ADDED: Price verification function
async function verifyPriceData(kite: any, tradingSymbol: string, exchange: string) {
  try {
    const quoteData = await kite.getQuote([`${exchange}:${tradingSymbol}`]);
    const instrumentData = quoteData[`${exchange}:${tradingSymbol}`];
    
    console.log('🔍 PRICE VERIFICATION DEBUG:', {
      symbol: tradingSymbol,
      currentPrice: instrumentData?.last_price,
      previousClose: instrumentData?.ohlc?.close,
      open: instrumentData?.ohlc?.open,
      high: instrumentData?.ohlc?.high,
      low: instrumentData?.ohlc?.low,
      volume: instrumentData?.volume,
      timestamp: new Date().toISOString()
    });
    
    if (instrumentData?.last_price && instrumentData?.ohlc?.close) {
      const actualChange = ((instrumentData.last_price - instrumentData.ohlc.close) / instrumentData.ohlc.close) * 100;
      console.log(`🎯 ACTUAL ZERODHA CHANGE: ${actualChange.toFixed(2)}%`);
      return actualChange;
    }
    
    return null;
  } catch (error) {
    console.error('❌ Price verification failed:', error);
    return null;
  }
}

function calculateVolumeMetrics(historicalData: HistoricalData[], currentVolume?: number, isUsingHistoricalFallback: boolean = false,istHours?: number,istMinutes?: number): {
  avg20DayVolume: number;
  todayVolumePercentage: number;
  estimatedTodayVolume: number;
} {
  console.log('📊 calculateVolumeMetrics called with:', {
    historicalDataLength: historicalData.length,
    currentVolume: currentVolume,
    isUsingHistoricalFallback: isUsingHistoricalFallback
  });
  
  let result = {
    avg20DayVolume: 1000,
    todayVolumePercentage: 100,
    estimatedTodayVolume: 1000
  };
  
  if (!historicalData.length) {
    console.log('❌ No historical data available');
    return result;
  }
  
  const dataForAverage = historicalData.filter(entry => entry.totalVolume > 0);
  console.log('📊 Available data with volume > 0:', dataForAverage.length, 'entries');
  
  if (dataForAverage.length === 0) {
    console.log('❌ No data with volume > 0 available');
    return result;
  }
  
  const totalVolume = dataForAverage.reduce((sum, entry) => sum + entry.totalVolume, 0);
  const averageVolume = totalVolume / dataForAverage.length;
  
  console.log('📊 Calculated average from', dataForAverage.length, 'days:', averageVolume);
  
  result.avg20DayVolume = Math.max(Math.round(averageVolume), 1000);
  
  if (currentVolume && currentVolume > 0 && !isUsingHistoricalFallback) {
    const marketProgress = istHours && istMinutes ? 
      (istHours >= 9 && istHours < 15 ? (istHours - 9) + (istMinutes / 60) : 6.25) : 
      (new Date().getHours() >= 9 && new Date().getHours() < 15 ? 
        (new Date().getHours() - 9) + (new Date().getMinutes() / 60) : 6.25);

    console.log('🕒 MARKET PROGRESS DEBUG:', {
      istHours,
      istMinutes,
      calculatedProgress: marketProgress,
      currentVolume,
      estimatedTodayVolume: Math.round(currentVolume * (6.25 / marketProgress))
    });
    
    result.todayVolumePercentage = Math.max(parseFloat((currentVolume / averageVolume * 100).toFixed(1)), 1);
    result.estimatedTodayVolume = Math.max(Math.round(currentVolume * (6.25 / marketProgress)), 1000);
    
    console.log('📊 Using LIVE volume data:', {
      currentVolume,
      marketProgress,
      todayVolumePercentage: result.todayVolumePercentage,
      estimatedTodayVolume: result.estimatedTodayVolume
    });
  } else if (historicalData.length > 0) {
    const sortedHistorical = historicalData.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const latestHistorical = sortedHistorical[0];
    
    if (latestHistorical && latestHistorical.totalVolume > 0) {
      const lastVolume = latestHistorical.totalVolume;
      
      result.todayVolumePercentage = Math.max(parseFloat((lastVolume / averageVolume * 100).toFixed(1)), 1);
      result.estimatedTodayVolume = lastVolume;
      
      console.log('📊 Using HISTORICAL volume for non-market hours:', {
        lastVolume,
        percentage: result.todayVolumePercentage,
        averageVolume,
        calculatedPercentage: (lastVolume / averageVolume * 100).toFixed(1) + '%',
        source: isUsingHistoricalFallback ? 'HISTORICAL_FALLBACK' : 'NON_MARKET_HOURS'
      });
    }
  }
  
  return result;
}

// NEW: Calculate actual OI change from historical data
async function getOIChangePercent(strike: number, currentOI: number, instrumentType: 'CE' | 'PE', symbol: string): Promise<number | null> {
  try {
    // Try to get previous OI data from Redis
    const oiHistoryKey = `oi_history_${symbol.toUpperCase()}`;
    const oiHistoryData = await getRedisData(oiHistoryKey);
    
    if (oiHistoryData) {
      const oiHistory: Record<string, Record<string, { ce_oi: number; pe_oi: number }>> = JSON.parse(oiHistoryData);
      
      // Get the most recent previous timestamp (excluding current minute if exists)
      const timestamps = Object.keys(oiHistory).sort();
      if (timestamps.length >= 2) {
        const previousTimestamp = timestamps[timestamps.length - 2]; // Second most recent
        const previousOI = oiHistory[previousTimestamp]?.[strike]?.[instrumentType.toLowerCase() as 'ce_oi' | 'pe_oi'];
        
        if (previousOI && previousOI > 0 && currentOI > 0) {
          const changePercent = ((currentOI - previousOI) / previousOI) * 100;
          console.log(`📊 OI CHANGE: ${symbol} ${strike}${instrumentType} - ${previousOI} → ${currentOI} = ${changePercent.toFixed(1)}%`);
          return changePercent;
        }
      }
    }
    
    // No historical data available
    console.log(`📊 OI CHANGE: No historical data for ${symbol} ${strike}${instrumentType}`);
    return null;
  } catch (error) {
    console.error('❌ Error calculating OI change:', error);
    return null;
  }
}

// UPDATED: OI Trend Analysis with actual change calculation
async function calculateOITrend(
  mainOI: number, 
  oppositeOI: number, 
  ratio: number, 
  type: 'support' | 'resistance',
  strike: number,
  symbol: string
): Promise<{
  direction: 'BUILDING' | 'DECLINING' | 'STABLE';
  changePercent: number;
  significance: 'LOW' | 'MEDIUM' | 'HIGH';
  icon: string;
} | null> {
  // Determine which OI to track changes for
  const instrumentType = type === 'support' ? 'PE' : 'CE';
  const oiToTrack = type === 'support' ? mainOI : mainOI;
  
  // Calculate actual change percent
  const changePercent = await getOIChangePercent(strike, oiToTrack, instrumentType, symbol);
  
  // If no historical data available, return null to indicate no trend analysis
  if (changePercent === null) {
    return null;
  }
  
  let direction: 'BUILDING' | 'DECLINING' | 'STABLE';
  let significance: 'LOW' | 'MEDIUM' | 'HIGH';
  
  if (changePercent > 20) {
    direction = 'BUILDING';
    significance = 'HIGH';
  } else if (changePercent > 10) {
    direction = 'BUILDING';
    significance = 'MEDIUM';
  } else if (changePercent > 5) {
    direction = 'BUILDING';
    significance = 'LOW';
  } else if (changePercent < -10) {
    direction = 'DECLINING';
    significance = 'HIGH';
  } else if (changePercent < -5) {
    direction = 'DECLINING';
    significance = 'MEDIUM';
  } else if (changePercent < 0) {
    direction = 'DECLINING';
    significance = 'LOW';
  } else {
    direction = 'STABLE';
    significance = 'LOW';
  }
  
  const icon = direction === 'BUILDING' ? '↗️' : direction === 'DECLINING' ? '↘️' : '➡️';
  
  return {
    direction,
    changePercent,
    significance,
    icon
  };
}

// ENHANCED: Support Levels with OI Trend Analysis
async function findSupportLevels(
  currentPrice: number, 
  optionsByStrike: Record<number, { ce_oi: number, pe_oi: number }>, 
  allStrikes: number[],
  symbol: string
): Promise<EnhancedSupportResistanceLevel[]> {
  console.log('🔍 OI SUPPORT CALCULATION DETAILS:');
  console.log('CMP:', currentPrice);
  
  const candidates: EnhancedSupportResistanceLevel[] = [];
  
  for (const strike of allStrikes) {
    if (strike < currentPrice) {
      const { ce_oi, pe_oi } = optionsByStrike[strike] || { ce_oi: 0, pe_oi: 0 };
      const oiRatio = pe_oi / ce_oi;
      
      if (pe_oi < 30000 || ce_oi < 1000) {
        continue;
      }
      
      if (oiRatio >= 1.3) {
        console.log(`  ✅ OI SUPPORT CANDIDATE - Strike ${strike}, Ratio ${oiRatio.toFixed(2)}`);
        
        const oiTrend = await calculateOITrend(pe_oi, ce_oi, oiRatio, 'support', strike, symbol);
        
        let strength: 'weak' | 'medium' | 'strong';
        let tooltip = `PE: ${(pe_oi / 100000).toFixed(1)}L, CE: ${(ce_oi / 100000).toFixed(1)}L, Ratio: ${oiRatio.toFixed(2)}:1 | PUT writer support`;
        
        if ((oiRatio >= 3 && pe_oi > 1000000) || (oiRatio >= 4) || (pe_oi > 2000000)) {
          strength = 'strong';
        } else if (oiRatio >= 1.8) {
          strength = 'medium';
        } else {
          strength = 'weak';
        }
        
        // Create display strength with arrow
        const displayStrength = oiTrend ? `${strength} ${oiTrend.icon}` : `${strength} ➡️`;
        
        candidates.push({ 
          price: strike, 
          strength, 
          type: 'support', 
          tooltip,
          oiTrend: oiTrend || undefined,
          currentOI: { ce_oi, pe_oi },
          displayStrength // Added for formatted display
        });
      }
    }
  }
  
  console.log('🔍 OI Supports found:', candidates.map(c => `${c.price} (${c.strength})`));
  if (candidates.length === 0) return [];
  
  // Sort by proximity to current price (nearest first)
  candidates.sort((a, b) => Math.abs(currentPrice - b.price) - Math.abs(currentPrice - a.price));
  const significantLevels = candidates.slice(0, 5);
  return significantLevels.sort((a, b) => b.price - a.price); // Highest support first (nearest to current price)
}

// ENHANCED: Resistance Levels with OI Trend Analysis
async function findResistanceLevels(
  currentPrice: number, 
  optionsByStrike: Record<number, { ce_oi: number, pe_oi: number }>, 
  allStrikes: number[],
  symbol: string
): Promise<EnhancedSupportResistanceLevel[]> {
  console.log('🔍 RESISTANCE LEVELS: Starting calculation');
  const candidates: EnhancedSupportResistanceLevel[] = [];
  
  for (const strike of allStrikes) {
    if (strike > currentPrice) {
      const { ce_oi, pe_oi } = optionsByStrike[strike] || { ce_oi: 0, pe_oi: 0 };
      if (ce_oi < 30000 || pe_oi < 1000) continue;
      
      const oiRatio = ce_oi / pe_oi;
      if (oiRatio >= 1.3) {
        const oiTrend = await calculateOITrend(ce_oi, pe_oi, oiRatio, 'resistance', strike, symbol);
        
        let strength: 'weak' | 'medium' | 'strong';
        let tooltip = `CE: ${(ce_oi / 100000).toFixed(1)}L, PE: ${(pe_oi / 100000).toFixed(1)}L, Ratio: ${oiRatio.toFixed(2)}:1 | CALL writer resistance`;
        
        if ((oiRatio >= 3 && ce_oi > 1000000) || (oiRatio >= 4) || (ce_oi > 2000000)) {
          strength = 'strong';
        } else if (oiRatio >= 1.8) {
          strength = 'medium';
        } else {
          strength = 'weak';
        }
        
        // Create display strength with arrow
        const displayStrength = oiTrend ? `${strength} ${oiTrend.icon}` : `${strength} ➡️`;
        
        candidates.push({ 
          price: strike, 
          strength, 
          type: 'resistance', 
          tooltip,
          oiTrend: oiTrend || undefined,
          currentOI: { ce_oi, pe_oi },
          displayStrength // Added for formatted display
        });
      }
    }
  }
  
  if (candidates.length === 0) {
    console.log('🔍 RESISTANCE LEVELS: No candidates found');
    return [];
  }
  
  // Sort by proximity to current price (nearest first)
  candidates.sort((a, b) => Math.abs(currentPrice - a.price) - Math.abs(currentPrice - b.price));
  const significantLevels = candidates.slice(0, 5);
  console.log(`🔍 RESISTANCE LEVELS: Found ${significantLevels.length} significant levels`);
  return significantLevels.sort((a, b) => a.price - b.price); // Lowest resistance first (nearest to current price)
}

function calculateSupportResistance(history: HistoricalData[], currentPrice: number): SupportResistanceLevel[] {
  if (!history || history.length === 0 || !currentPrice) return [];
  
  console.log('🔍 HISTORICAL SUPPORT/RESISTANCE CALCULATION:');
  const levels: SupportResistanceLevel[] = [];
  const priceLevels = new Map<number, {volume: number, strength: 'weak' | 'medium' | 'strong'}>();
  const priceRange = currentPrice * 0.20;
  
  history.forEach(entry => {
    if (entry.lastPrice && Math.abs(entry.lastPrice - currentPrice) <= priceRange) {
      const roundedPrice = Math.round(entry.lastPrice / 5) * 5;
      const currentData = priceLevels.get(roundedPrice) || {volume: 0, strength: 'weak'};
      const newVolume = currentData.volume + (entry.totalVolume || 0);
      
      let strength: 'weak' | 'medium' | 'strong' = 'weak';
      if (newVolume > currentPrice * 1000) strength = 'medium';
      if (newVolume > currentPrice * 5000) strength = 'strong';
      
      priceLevels.set(roundedPrice, {volume: newVolume, strength});
    }
  });
  
  const sortedLevels = Array.from(priceLevels.entries())
    .sort((a, b) => b[1].volume - a[1].volume)
    .slice(0, 15);
  
  console.log('🔍 Historical levels found:', sortedLevels.map(([price, data]) => 
    `${price} (vol: ${data.volume}, strength: ${data.strength})`
  ));
  
  sortedLevels.forEach(([price, data]) => {
    const distancePercent = Math.abs(price - currentPrice) / currentPrice * 100;
    const isSupport = price < currentPrice;
    
    let includeLevel = false;
    
    if (data.strength === 'strong' && distancePercent >= 0.5) {
      includeLevel = true;
    } else if (data.strength === 'medium' && distancePercent >= 1) {
      includeLevel = true;
    } else if (data.strength === 'weak' && distancePercent >= 5) {
      includeLevel = true;
    }
    
    if (includeLevel) {
      levels.push({ 
        price, 
        strength: data.strength, 
        type: isSupport ? 'support' : 'resistance', 
        tooltip: `Historical Volume Level (${data.strength})` 
      });
      console.log(`✅ Included ${price} as ${isSupport ? 'support' : 'resistance'} (${data.strength}, ${distancePercent.toFixed(1)}% away)`);
    } else {
      console.log(`❌ Excluded ${price} (${data.strength} ${isSupport ? 'support' : 'resistance'}) - too close: ${distancePercent.toFixed(1)}%`);
    }
  });
  
  levels.sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice));
  
  return levels.slice(0, 10);
}

// UPDATED: Get Final Levels - OI-ONLY with Nearest Levels First
async function getFinalLevels(
  symbol: string, 
  history: HistoricalData[], 
  currentPrice: number, 
  optionsByStrike: Record<number, { ce_oi: number, pe_oi: number }>, 
  allStrikes: number[]
): Promise<{ supports: EnhancedSupportResistanceLevel[], resistances: EnhancedSupportResistanceLevel[] }> {
  
  console.log('🔍 FINAL LEVELS DEBUG =================');
  console.log('Symbol:', symbol);
  console.log('Current Price:', currentPrice);
  
  // Use only OI-based levels
  console.log('📊 OI-BASED SUPPORT ANALYSIS:');
  const oiSupports = await findSupportLevels(currentPrice, optionsByStrike, allStrikes, symbol);
  console.log('OI Supports found:', oiSupports.map(s => `${s.price} (${s.strength})`));
  
  console.log('📊 OI-BASED RESISTANCE ANALYSIS:');
  const oiResistances = await findResistanceLevels(currentPrice, optionsByStrike, allStrikes, symbol);
  console.log('OI Resistances found:', oiResistances.map(r => `${r.price} (${r.strength})`));

  // Take top 2 levels each (already sorted by proximity)
  const finalSupports = oiSupports.slice(0, 2);
  const finalResistances = oiResistances.slice(0, 2);
  
  console.log('🎯 FINAL SUPPORTS (Nearest First):', finalSupports.map(s => `${s.price} (${s.strength})`));
  console.log('🎯 FINAL RESISTANCES (Nearest First):', finalResistances.map(r => `${r.price} (${r.strength})`));
  console.log('====================================');

  return {
    supports: finalSupports,
    resistances: finalResistances
  };
}

// UPDATED: Smart sentiment with proper volume classification
function calculateSmartSentiment(
  pcr: number,
  volumePcr: number,
  highestPutOI: number,
  highestCallOI: number,
  todayVolumePercentage: number,
  estimatedTodayVolume: number, 
  averageVolume: number, 
  adAnalysis?: ADAnalysis,
  vwapAnalysis?: VWAPAnalysis,
  isMarketOpen?: boolean,
  changePercent?: number,
  historicalDataLength?: number,
  volumePcrIsEstimated?: boolean, // --- FIX: true when volumePcr is a proxy/fallback, not genuinely live volume data
  maxPain?: number,      // --- NEW: strike price of max pain, for the 7th weighted component
  currentPrice?: number, // --- NEW: LTP, needed to compare against maxPain
  relativeStrengthGap?: number, // --- NEW: 8th component. Added strictly at the END of the parameter list this time, per the lesson learned earlier tonight (adding a param in the MIDDLE silently shifted every argument after it).
  niftyDataAvailable?: boolean
): { sentiment: string; score: number; breakdown: string[]; maxPainSentiment?: { label: string; color: string } } {
  console.log('🧠 SENTIMENT CALCULATION:', { 
    pcr, volumePcr, highestPutOI, highestCallOI, todayVolumePercentage, changePercent, historicalDataLength
  });
  
  const dataLength = historicalDataLength || 0;
  const breakdown: string[] = [];
  
  // 1. PCR Score
  let pcrScore = 0;
  if (pcr > 1.3) pcrScore = 2;
  else if (pcr > 1.1) pcrScore = 1;
  else if (pcr >= 0.9) pcrScore = 0;
  else if (pcr < 0.7) pcrScore = -2;
  else if (pcr < 0.9) pcrScore = -1;

  const oiPCRContext = pcr < 0.7 ? " (bearish)" : 
                      pcr < 0.9 ? " (slightly bearish)" :
                      pcr <= 1.1 ? " (neutral)" :
                      pcr <= 1.3 ? " (slightly bullish)" : " (bullish)";
  breakdown.push(`${pcrScore >= 0 ? '+' : ''}${pcrScore} • OI PCR ${pcr.toFixed(2)}${oiPCRContext}`);

  // 2. Conviction Score - REMOVED as requested (call wall line)
  let convictionScore = 0;

  // 3. Volume PCR Modifier
  let volumeModifier = 0;
  if (volumePcr < 0.7) volumeModifier = 2;
  else if (volumePcr < 0.9) volumeModifier = 1;
  else if (volumePcr <= 1.1) volumeModifier = 0;
  else if (volumePcr > 1.3) volumeModifier = -2;
  else if (volumePcr > 1.1) volumeModifier = -1;

  const volumePCRContext = volumePcr < 0.7 ? " (bullish volume)" : 
                        volumePcr < 0.9 ? " (slightly bullish volume)" :
                        volumePcr <= 1.1 ? " (neutral volume)" :
                        volumePcr <= 1.3 ? " (slightly bearish volume)" : " (bearish volume)";
  breakdown.push(`${volumeModifier >= 0 ? '+' : ''}${volumeModifier} • Volume PCR ${volumePcr.toFixed(2)}${volumePCRContext}`);

  // 4. A/D Line Analysis Score
  // --- FIX: replaced with a 3-signal VOTING system, incorporating the two
  // new signals we added (Recent 10-Day Momentum, Overall Trend/EMA)
  // alongside Today's Signal — previously only Today's Signal fed the
  // score at all, leaving the two new calculations as display-only, real
  // analysis that never actually influenced the composite verdict.
  //
  // Each of the 3 signals votes +1 (bullish), -1 (bearish), or 0
  // (neutral/weak/sideways). Summing them naturally produces the exact
  // "agreement strengthens, disagreement dampens" behavior we wanted:
  // all 3 bullish = +3, all 3 bearish = -3, mixed = something in between.
  // Deliberately simple (not weighted by strength level) per explicit
  // preference — this does mean STRONG vs VERY_STRONG etc. aren't
  // distinguished in the SCORE specifically, though they remain visible
  // in the displayed badges/labels.
  let adScore = 0;
  let adContext = "";
  const adVoteParts: string[] = [];

  if (adAnalysis) {
    // Vote 1: Today's Signal (MODERATE or stronger required to vote; WEAK counts as neutral)
    let todayVote = 0;
    if (adAnalysis.todaySignal === 'ACCUMULATION' && adAnalysis.todayStrength !== 'WEAK') todayVote = 1;
    else if (adAnalysis.todaySignal === 'DISTRIBUTION' && adAnalysis.todayStrength !== 'WEAK') todayVote = -1;
    adVoteParts.push(`Today ${adAnalysis.todaySignal}`);

    // Vote 2: Recent 10-Day Momentum (only if it's had enough days to be meaningful)
    let momentumVote = 0;
    if (adAnalysis.trendDaysUsed >= 20) {
      if (adAnalysis.trend === 'BULLISH') momentumVote = 1;
      else if (adAnalysis.trend === 'BEARISH') momentumVote = -1;
    }
    adVoteParts.push(`Momentum ${adAnalysis.trend}`);

    // Vote 3: Overall Trend (EMA-based) — only if it's had enough days AND isn't Neutral
    let overallVote = 0;
    if (adAnalysis.overallTrendDaysUsed >= 20 && adAnalysis.trendStrengthLabel !== 'Neutral') {
      if (adAnalysis.overallTrend === 'ACCUMULATION') overallVote = 1;
      else if (adAnalysis.overallTrend === 'DISTRIBUTION') overallVote = -1;
    }
    adVoteParts.push(`Overall ${adAnalysis.overallTrend}`);

    adScore = todayVote + momentumVote + overallVote;

    const agreeCount = [todayVote, momentumVote, overallVote].filter(v => v !== 0 && Math.sign(v) === Math.sign(adScore || 1)).length;
    adContext = ` (${adVoteParts.join(', ')})`;
  } else {
    adContext = " (data unavailable)";
  }

  // Enhanced A/D context for insufficient data
  let enhancedAdContext = adContext;
  if (dataLength === 0) {
    enhancedAdContext = " (new stock - data collection in progress)";
  } else if (dataLength < 10) {
    enhancedAdContext = ` (${dataLength}/10 days - limited data)`;
  }

  breakdown.push(`${adScore >= 0 ? '+' : ''}${adScore} • A/D Line${enhancedAdContext}`);

  // 5. VWAP Score
  let vwapScore = 0;
  let vwapContext = "";

  if (vwapAnalysis && vwapAnalysis.value !== null) {
    const deviation = vwapAnalysis.deviationPercent;
    
    if (deviation > 2.0) {
      vwapScore = 2;
      vwapContext = ` (strong bullish - ${deviation.toFixed(2)}% above VWAP)`;
    } else if (deviation > 1.0) {
      vwapScore = 1;
      vwapContext = ` (moderate bullish - ${deviation.toFixed(2)}% above VWAP)`;
    } else if (deviation > -1.0) {
      vwapScore = 0;
      vwapContext = ` (neutral - near VWAP)`;
    } else if (deviation > -2.0) {
      vwapScore = -1;
      vwapContext = ` (moderate bearish - ${Math.abs(deviation).toFixed(2)}% below VWAP)`;
    } else {
      vwapScore = -2;
      vwapContext = ` (strong bearish - ${Math.abs(deviation).toFixed(2)}% below VWAP)`;
    }
  } else {
    vwapContext = " (data unavailable)";
  }

  breakdown.push(`${vwapScore >= 0 ? '+' : ''}${vwapScore} • VWAP Position${vwapContext}`);

  // 6. Price Action Score - NEW
  let priceActionScore = 0;
  let priceActionContext = "";

  if (changePercent !== undefined) {
    if (changePercent > 0.5) {
      priceActionScore = 1;
      priceActionContext = ` (bullish price action)`;
    } else if (changePercent < -0.5) {
      priceActionScore = -1;
      priceActionContext = ` (bearish price action)`;
    } else {
      priceActionScore = 0;
      priceActionContext = ` (neutral price action)`;
    }
  } else {
    priceActionContext = " (data unavailable)";
  }

  breakdown.push(`${priceActionScore >= 0 ? '+' : ''}${priceActionScore} • Price Action${priceActionContext}`);

  // 7. Today's Volume Percentage Impact - FIXED VOLUME CLASSIFICATION
  let volumePercentageScore = 0;
  let volumePercentageContext = "";

  const estimatedVolumePercentage = (estimatedTodayVolume / averageVolume) * 100;
  const volumeLabel = isMarketOpen ? "Today Volume" : "Last Trading Volume";

  // Calculate bullish/bearish bias from key indicators
  const bullishIndicators = (adScore > 0 ? 1 : 0) + (priceActionScore > 0 ? 1 : 0) + (vwapScore > 0 ? 1 : 0);
  const bearishIndicators = (adScore < 0 ? 1 : 0) + (priceActionScore < 0 ? 1 : 0) + (vwapScore < 0 ? 1 : 0);
  
  const hasBullishBias = bullishIndicators > bearishIndicators;
  const hasBearishBias = bearishIndicators > bullishIndicators;
  const isNeutral = bullishIndicators === bearishIndicators;

  // FIXED: Proper volume classification thresholds
  if (estimatedVolumePercentage > 200) {
    // Very High volume (>200%)
    if (hasBullishBias) {
      volumePercentageScore = 2;
      volumePercentageContext = ` (very high volume strongly confirming bullish move - projected ${estimatedVolumePercentage.toFixed(1)}% of avg)`;
    } else if (hasBearishBias) {
      volumePercentageScore = -2;
      volumePercentageContext = ` (very high volume strongly confirming bearish move - projected ${estimatedVolumePercentage.toFixed(1)}% of avg)`;
    } else {
      volumePercentageScore = 0;
      volumePercentageContext = ` (very high volume significantly amplifying sentiment - projected ${estimatedVolumePercentage.toFixed(1)}% of avg)`;
    }
  } else if (estimatedVolumePercentage > 130) {
    // High volume (130-200%)
    if (hasBullishBias) {
      volumePercentageScore = 1;
      volumePercentageContext = ` (high volume confirming bullish move - projected ${estimatedVolumePercentage.toFixed(1)}% of avg)`;
    } else if (hasBearishBias) {
      volumePercentageScore = -1;
      volumePercentageContext = ` (high volume confirming bearish move - projected ${estimatedVolumePercentage.toFixed(1)}% of avg)`;
    } else {
      volumePercentageScore = 0;
      volumePercentageContext = ` (high volume amplifying sentiment - projected ${estimatedVolumePercentage.toFixed(1)}% of avg)`;
    }
  } else if (estimatedVolumePercentage < 30) {
    // Very Low volume (<30%) - FIXED LOGIC
    if (hasBullishBias) {
      volumePercentageScore = -2; // Very low volume strongly weakens bullish conviction
      volumePercentageContext = isMarketOpen ? 
        ` (very low volume strongly weakens bullish conviction - projected ${estimatedVolumePercentage.toFixed(1)}% of avg)` :
        ` (very low volume strongly weakens bullish conviction)`;
    } else if (hasBearishBias) {
      volumePercentageScore = 2; // Very low volume strongly weakens bearish conviction
      volumePercentageContext = isMarketOpen ? 
        ` (very low volume strongly weakens bearish conviction - projected ${estimatedVolumePercentage.toFixed(1)}% of avg)` :
        ` (very low volume strongly weakens bearish conviction)`;
    } else {
      volumePercentageScore = 0;
      volumePercentageContext = isMarketOpen ? 
        ` (very low volume - no clear direction - projected ${estimatedVolumePercentage.toFixed(1)}% of avg)` :
        ` (very low volume - no clear direction)`;
    }
  } else if (estimatedVolumePercentage < 70) {
    // Low volume (30-70%) - FIXED LOGIC
    if (hasBullishBias) {
      volumePercentageScore = -1; // Low volume weakens bullish conviction
      volumePercentageContext = isMarketOpen ? 
        ` (low volume weakens bullish conviction - projected ${estimatedVolumePercentage.toFixed(1)}% of avg)` :
        ` (low volume weakens bullish conviction)`;
    } else if (hasBearishBias) {
      volumePercentageScore = 1; // Low volume weakens bearish conviction
      volumePercentageContext = isMarketOpen ? 
        ` (low volume weakens bearish conviction - projected ${estimatedVolumePercentage.toFixed(1)}% of avg)` :
        ` (low volume weakens bearish conviction)`;
    } else {
      volumePercentageScore = 0;
      volumePercentageContext = isMarketOpen ? 
        ` (low volume - no clear direction - projected ${estimatedVolumePercentage.toFixed(1)}% of avg)` :
        ` (low volume - no clear direction)`;
    }
  } else {
    // Moderate volume (70-130%)
    volumePercentageScore = 0;
    volumePercentageContext = isMarketOpen ? 
      ` (moderate volume - projected ${estimatedVolumePercentage.toFixed(1)}% of avg)` :
      ` (moderate volume)`;
  }

  // Enhanced volume context for new stocks
  let volumeDisplayContext = volumePercentageContext;
  if (dataLength === 0) {
    volumeDisplayContext = " (new stock - data collection in progress)";
  } else if (dataLength < 5) {
    volumeDisplayContext = ` (${dataLength}/5 days - limited data)`;
  }

  breakdown.push(`${volumePercentageScore >= 0 ? '+' : ''}${volumePercentageScore} • ${volumeLabel} ${todayVolumePercentage.toFixed(1)}%${volumeDisplayContext}`);

  // --- FIX (3 issues found on review):
  //
  // 1. UNEQUAL RANGES: raw scores had different max magnitudes (A/D: ±3,
  //    Price Action: ±1, others: ±2) but weights were applied directly to
  //    these raw numbers. This made A/D Line's REAL influence ~4x larger
  //    than Price Action's despite similar weight values (0.20 vs 0.15) —
  //    an unintended side effect, not a deliberate design choice. Fixed by
  //    normalizing every component to a common -1..+1 scale BEFORE
  //    applying weights, so a component's actual influence now matches
  //    its stated weight.
  //
  // 2. UNREACHABLE THRESHOLDS: with the old raw-score math, the maximum
  //    possible |weightedScore| was ~4.1 — but "Strongly Bullish/Bearish"
  //    required |score| >= 5, which could NEVER trigger no matter how
  //    extreme every indicator was simultaneously. Fixed as a natural
  //    side effect of normalization: since weights sum to 1.0 and each
  //    normalized component is bounded to [-1,1], the weighted sum is
  //    naturally bounded to [-1,1] — multiplying by 10 (not 2) now gives
  //    a genuinely reachable, symmetric -10..+10 range matching what the
  //    sentiment thresholds actually expect.
  //
  // 3. DOUBLE-COUNTING: when volumePcr is an estimated PROXY using the
  //    same real OI-based `pcr` value (see the timeout/fallback fix
  //    earlier in this file), the identical underlying data point was
  //    being counted TWICE — once as pcrScore (weight 0.20) and again as
  //    volumeModifier (weight 0.15) — inflating apparent confirmation
  //    from what is actually a single data source, not two independent
  //    ones. Fixed by detecting this specific case (estimated AND equal
  //    to pcr, distinguishing it from the neutral-fallback case which
  //    sets volumePcr=1.0) and excluding it from the weighted score,
  //    redistributing its weight proportionally across the remaining
  //    genuinely-independent components.

  const volumePcrIsDuplicateOfOI = !!volumePcrIsEstimated && Math.abs(volumePcr - pcr) < 0.001;

  // --- NEW: Max Pain component. Theory: if Max Pain sits ABOVE current
  // price, the theorized "pull toward Max Pain" works in favor of a long
  // position (bullish); if BELOW, it works against one (bearish). Scaled
  // by % distance between the two — a bigger gap means a stronger
  // theorized pull. Same -2..+2 raw range convention as OI PCR/VWAP/etc
  // for consistency before normalization.
  let maxPainScore = 0;
  let maxPainPercentDiff = 0;
  const hasValidMaxPainData = !!maxPain && maxPain > 0 && !!currentPrice && currentPrice > 0;
  if (hasValidMaxPainData) {
    maxPainPercentDiff = ((maxPain! - currentPrice!) / currentPrice!) * 100;
    if (maxPainPercentDiff >= 5) maxPainScore = 2;
    else if (maxPainPercentDiff >= 2) maxPainScore = 1;
    else if (maxPainPercentDiff <= -5) maxPainScore = -2;
    else if (maxPainPercentDiff <= -2) maxPainScore = -1;
    else maxPainScore = 0; // within +-2% is treated as too close to call
  }
  const maxPainLabel = !hasValidMaxPainData
    ? null
    : maxPainScore > 0 ? 'Bullish' : maxPainScore < 0 ? 'Bearish' : 'Neutral';
  const maxPainColorClass = maxPainLabel === 'Bullish' ? 'text-green-400' : maxPainLabel === 'Bearish' ? 'text-red-400' : 'text-gray-400';
  if (hasValidMaxPainData) {
    breakdown.push(`${maxPainScore >= 0 ? '+' : ''}${maxPainScore} • Max Pain ${maxPain} vs CMP ${currentPrice} (${maxPainPercentDiff >= 0 ? '+' : ''}${maxPainPercentDiff.toFixed(1)}%, ${maxPainLabel!.toLowerCase()})`);
  }

  // --- NEW: Relative Strength vs Nifty (8th component). Same threshold
  // pattern as Max Pain: >2pts = strong signal, 1-2pts = mild, within
  // +-1pt = too close to call either way.
  let relativeStrengthScore = 0;
  if (niftyDataAvailable && relativeStrengthGap !== undefined) {
    if (relativeStrengthGap > 2) relativeStrengthScore = 2;
    else if (relativeStrengthGap > 1) relativeStrengthScore = 1;
    else if (relativeStrengthGap < -2) relativeStrengthScore = -2;
    else if (relativeStrengthGap < -1) relativeStrengthScore = -1;
    else relativeStrengthScore = 0;
    const relativeStrengthLabelForScore = relativeStrengthScore > 0 ? 'Outperforming' : relativeStrengthScore < 0 ? 'Underperforming' : 'In line with market';
    breakdown.push(`${relativeStrengthScore >= 0 ? '+' : ''}${relativeStrengthScore} • Relative Strength: ${relativeStrengthLabelForScore} Nifty by ${Math.abs(relativeStrengthGap).toFixed(2)} pts`);
  }

  const baseWeights = {
    oiPcr: 0.153,
    volumePcr: 0.11475,
    adLine: 0.153,
    vwap: 0.11475,
    priceAction: 0.11475,
    volumePercent: 0.11475,
    maxPain: 0.135,
    relativeStrength: 0.10, // --- NEW: 8th component, sums to 1.0 with the seven above. Weighted lighter than the core signals since this is more of a market-context adjuster than a direct signal about the stock's own options positioning or money flow.
  };

  const weights = { ...baseWeights };
  if (!niftyDataAvailable) {
    // No Nifty data available this call — exclude it and redistribute,
    // same pattern already used for maxPain/volumePcr above.
    const removedWeight = weights.relativeStrength;
    weights.relativeStrength = 0;
    const remainingKeys = (Object.keys(weights) as (keyof typeof weights)[]).filter(k => k !== 'relativeStrength');
    const remainingSum = remainingKeys.reduce((s, k) => s + weights[k], 0);
    remainingKeys.forEach(k => {
      weights[k] = weights[k] + (weights[k] / remainingSum) * removedWeight;
    });
  }
  if (!hasValidMaxPainData) {
    // No max pain data available this call — exclude it and redistribute
    // its weight, same pattern already used for the volumePcr duplicate case.
    const removedWeight = weights.maxPain;
    weights.maxPain = 0;
    const remainingKeys = (Object.keys(weights) as (keyof typeof weights)[]).filter(k => k !== 'maxPain');
    const remainingSum = remainingKeys.reduce((s, k) => s + weights[k], 0);
    remainingKeys.forEach(k => {
      weights[k] = weights[k] + (weights[k] / remainingSum) * removedWeight;
    });
  }
  if (volumePcrIsDuplicateOfOI) {
    const removedWeight = weights.volumePcr;
    weights.volumePcr = 0;
    const remainingKeys = (Object.keys(weights) as (keyof typeof weights)[]).filter(k => k !== 'volumePcr');
    const remainingSum = remainingKeys.reduce((s, k) => s + weights[k], 0);
    remainingKeys.forEach(k => {
      weights[k] = weights[k] + (weights[k] / remainingSum) * removedWeight;
    });
    breakdown.push(`ℹ️ Volume PCR excluded from score (duplicate of OI PCR — no independent data available); weight redistributed`);
  }

  // Normalize each raw score to -1..+1 by dividing by its own max possible
  // magnitude, so weight now genuinely controls influence.
  const normalized = {
    oiPcr: pcrScore / 2,               // pcrScore range: -2..+2
    volumePcr: volumeModifier / 2,     // volumeModifier range: -2..+2
    adLine: adScore / 3,               // adScore range: -3..+3
    vwap: vwapScore / 2,               // vwapScore range: -2..+2
    priceAction: priceActionScore / 1, // priceActionScore range: -1..+1
    volumePercent: volumePercentageScore / 2, // range: -2..+2
    maxPain: maxPainScore / 2,         // maxPainScore range: -2..+2
    relativeStrength: relativeStrengthScore / 2, // --- NEW: range -2..+2
  };

  // Weighted sum is now naturally bounded to [-1, 1] since weights sum to
  // 1.0 and every normalized component is bounded to [-1, 1]. Scaling by
  // 10 (not 2) gives a genuinely reachable -10..+10 range.
  const weightedScore = (
    (normalized.oiPcr * weights.oiPcr) +
    (normalized.volumePcr * weights.volumePcr) +
    (normalized.adLine * weights.adLine) +
    (normalized.vwap * weights.vwap) +
    (normalized.priceAction * weights.priceAction) +
    (normalized.volumePercent * weights.volumePercent) +
    (normalized.maxPain * weights.maxPain) +
    (normalized.relativeStrength * weights.relativeStrength)
  ) * 10;

  const finalScore = Math.max(-10, Math.min(10, Math.round(weightedScore * 10) / 10));

  breakdown.push(`──────────────`);
  breakdown.push(`Weighted Score: ${finalScore >= 0 ? '+' : ''}${finalScore}`);

  let sentiment: string;
  if (finalScore >= 5) sentiment = "Strongly Bullish";
  else if (finalScore >= 3) sentiment = "Bullish";
  else if (finalScore >= 1) sentiment = "Slightly Bullish";
  else if (finalScore >= -1) sentiment = "Neutral";
  else if (finalScore >= -3) sentiment = "Slightly Bearish";
  else if (finalScore >= -5) sentiment = "Bearish";
  else sentiment = "Strongly Bearish";

  console.log(`🧠 FINAL SENTIMENT: ${sentiment} (Score: ${finalScore})`);
  
  return {
    sentiment,
    score: finalScore,
    breakdown,
    maxPainSentiment: maxPainLabel ? { label: maxPainLabel, color: maxPainColorClass } : undefined
  };
}


// --- MAIN API FUNCTION ---
export async function POST(request: Request) {
  console.log('🚀 API CALL STARTED ========================');
  try {
    const apiKey = process.env.KITE_API_KEY;
    if (!apiKey) {
      console.error('❌ Server configuration error: KITE_API_KEY missing');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const body = await request.json() as { symbol: string };
    const { symbol: displayName } = body;
    if (!displayName) {
      console.error('❌ Bad request: Symbol is required');
      return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });
    }

    console.log(`📈 PROCESSING SYMBOL: ${displayName}`);

    // --- NEW: short-lived cache on the FULL analysis response. Kite
    // Connect enforces roughly 3 requests/sec across the whole API key,
    // not per-user — with real concurrent traffic (multiple people
    // checking the same stock within a short window), that limit gets
    // hit fast and causes real failures, not graceful degradation.
    // Caching each symbol's complete result for 45s means only the FIRST
    // request in that window hits Kite live; everyone else checking the
    // same stock shortly after gets an instant cached response — both
    // protects against rate-limiting AND makes popular stocks feel
    // faster. 45s is short enough that "live" data still feels live for
    // this kind of options/sentiment analysis (not tick-by-tick trading).
    const cacheKey = `analysis_cache_${displayName.toUpperCase()}`;
    try {
      const cachedResponse = await getRedisData(cacheKey);
      if (cachedResponse) {
        console.log(`⚡ CACHE HIT for ${displayName} — returning cached result, no Kite call needed`);
        const parsed = JSON.parse(cachedResponse);
        return NextResponse.json({ ...parsed, servedFromCache: true });
      }
    } catch (cacheError) {
      console.error('⚠️ Cache read failed (continuing with live fetch):', cacheError);
    }
    console.log(`🔄 CACHE MISS for ${displayName} — proceeding with live Kite fetch`);

    const now = new Date();
    const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    const hours = istTime.getHours();
    const minutes = istTime.getMinutes();
    const timeInMinutes = hours * 60 + minutes;
    
    const preMarketStart = 9 * 60 + 0;
    const marketOpen = 9 * 60 + 15;
    const marketClose = 15 * 60 + 30;
    const isPreMarketWindow = (timeInMinutes >= preMarketStart && timeInMinutes < marketOpen);
    
    const isWeekend = istTime.getDay() === 0 || istTime.getDay() === 6;
    const isMarketHoliday = await checkIfMarketHoliday(istTime);
    const isTradingDay = !isWeekend && !isMarketHoliday;
    const isMarketOpen = timeInMinutes >= marketOpen && timeInMinutes < marketClose && isTradingDay;
    
    console.log('🕒 ENHANCED TIME DEBUG =================');
    console.log('Current UTC time:', now.toISOString());
    console.log('Current IST time:', istTime.toISOString());
    console.log('IST Hours:', hours, 'Minutes:', minutes);
    console.log('Time in minutes:', timeInMinutes);
    console.log('Day of week:', istTime.getDay(), '(0=Sun,1=Mon,...,6=Sat)');
    console.log('Pre-market window (9:00-9:15):', preMarketStart, 'to', marketOpen);
    console.log('Market hours (9:15-15:30):', marketOpen, 'to', marketClose);
    console.log('Is Weekend?', isWeekend);
    console.log('Is Market Holiday?', isMarketHoliday);
    console.log('Is Trading Day?', isTradingDay);
    console.log('Is Market Open?', isMarketOpen);
    console.log('Is Pre-market window?', isPreMarketWindow);
    console.log('Is After hours?', timeInMinutes >= marketClose || timeInMinutes < preMarketStart);
    console.log('================================');

    console.log('🔐 Authenticating with Google Sheets...');
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
    console.log('📊 Fetching trading symbol from Google Sheet...');
    const sheetResponse = await sheets.spreadsheets.values.get({ 
      spreadsheetId: process.env.GOOGLE_SHEET_ID, 
      range: 'stocks!A2:B' 
    });
    const rows = sheetResponse.data.values;
    if (!rows || rows.length === 0) {
      console.error('❌ Google Sheet is empty');
      return NextResponse.json({ error: 'Google Sheet is empty.' }, { status: 500 });
    } 
    const row = rows.find(r => r[0] === displayName);
    if (!row || !row[1]) {
      console.error(`❌ TradingSymbol for '${displayName}' not found`);
      return NextResponse.json({ error: `TradingSymbol for '${displayName}' not found.` }, { status: 404 });
    } 
    const tradingSymbol = row[1];
    console.log(`🔗 Mapped ${displayName} to trading symbol: ${tradingSymbol}`);

    console.log('🔑 Fetching Kite token from Redis...');
    const tokenData = await getRedisData('kite_token');
    if (!tokenData) {
      console.error('❌ Kite token not found in Redis');
      return NextResponse.json({ error: 'Kite token not found.' }, { status: 401 });
    }

    const kc = new KiteConnect({ api_key: apiKey });
    kc.setAccessToken(JSON.parse(tokenData).accessToken);

    console.log('📋 Fetching instruments from Kite...');
    const allInstruments = await getCachedInstruments(kc);
    const unfilteredOptionsChain = allInstruments.filter(instrument => 
      instrument.name === tradingSymbol.toUpperCase() && (instrument.instrument_type === 'CE' || instrument.instrument_type === 'PE')
    );
    if (unfilteredOptionsChain.length === 0) {
        console.error(`❌ No options found for '${tradingSymbol}'`);
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
    console.log(`📅 Options chain filtered to nearest expiry: ${nearestExpiry.toISOString().split('T')[0]}, ${optionsChain.length} instruments`);
    
    console.log('💰 ENHANCED PRICE FETCHING =================');
    const exchange = (displayName === 'NIFTY' || displayName === 'BANKNIFTY') ? 'NFO' : 'NSE';
    let ltp = 0;
    let currentVolume = 0;
    let todayOHLC = null;
    // --- NEW: Relative Strength vs Nifty. Piggybacked onto the SAME
    // getQuote() call as the stock itself (Kite supports multiple
    // instruments in one request) — zero extra Kite API calls, same
    // rate-limit discipline as everything else we protected tonight.
    let niftyChangePercent = 0;
    let niftyDataAvailable = false;

    try {
        const quoteDataForSymbol: QuoteData = await kc.getQuote([`${exchange}:${tradingSymbol}`, 'NSE:NIFTY 50']);
        ltp = quoteDataForSymbol[`${exchange}:${tradingSymbol}`]?.last_price || 0;
        currentVolume = quoteDataForSymbol[`${exchange}:${tradingSymbol}`]?.volume || 0;
        todayOHLC = quoteDataForSymbol[`${exchange}:${tradingSymbol}`]?.ohlc;

        const niftyQuote = quoteDataForSymbol['NSE:NIFTY 50'];
        if (niftyQuote && niftyQuote.ohlc?.close && niftyQuote.last_price) {
            niftyChangePercent = ((niftyQuote.last_price - niftyQuote.ohlc.close) / niftyQuote.ohlc.close) * 100;
            niftyDataAvailable = true;
        }
        
        console.log('💰 LIVE PRICE FETCH:', { 
            ltp, 
            currentVolume, 
            hasOHLC: !!todayOHLC,
            success: ltp > 0,
            niftyChangePercent,
            niftyDataAvailable
        });
    } catch (error: any) {
        // --- FIX: was only logging error.message, which showed "Unknown
        // error" — likely because Kite Connect's SDK sometimes throws a
        // plain response object rather than a real Error instance, so
        // .message was empty/undefined. Log everything available so the
        // ACTUAL reason (rate limit, invalid instrument key, permission
        // issue, network timeout, etc.) is visible in the logs instead of
        // being silently swallowed.
        console.log('⚠️ Live price fetch failed. Full error details:', {
            instrumentKey: `${exchange}:${tradingSymbol}`,
            message: error?.message,
            errorType: error?.error_type,
            responseData: error?.response?.data,
            responseStatus: error?.response?.status,
            stringified: (() => {
                try { return JSON.stringify(error); } catch { return 'could not stringify'; }
            })(),
            errorObject: error,
        });
    }

    const historicalData = await getHistoricalData(displayName);
    const historicalDataLength = historicalData.length;
    
    console.log('🔍 VOLUME DATA SOURCE DEBUG:', {
  symbol: displayName,
  historicalEntries: historicalDataLength,
  latestHistorical: historicalDataLength > 0 ? historicalData[0] : null,
  currentVolume: currentVolume,
  isMarketOpen: isMarketOpen
});
    const hasLiveData = ltp > 0 && currentVolume > 0;
    const shouldUseHistorical = !hasLiveData || (!isMarketOpen && !isTradingDay);

    console.log('🔄 DATA SOURCE ANALYSIS:', {
        hasLiveData,
        isMarketOpen,
        isTradingDay,
        shouldUseHistorical,
        historicalDataLength: historicalDataLength
    });

    if (shouldUseHistorical && historicalDataLength > 0) {
        console.log('🔄 Using historical data fallback for non-market hours');
        
        const sortedHistorical = historicalData.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const latestHistorical = sortedHistorical[0];
        
        if (latestHistorical && latestHistorical.lastPrice) {
            if (ltp === 0) {
                ltp = latestHistorical.lastPrice;
                console.log(`📊 Using historical LTP: ${ltp} from ${latestHistorical.date}`);
            }
            
            if (currentVolume === 0) {
                currentVolume = latestHistorical.totalVolume || 0;
                console.log(`📊 Using historical volume: ${currentVolume} from ${latestHistorical.date}`);
            }
            
            if (!todayOHLC && latestHistorical.lastPrice) {
                todayOHLC = {
                    open: latestHistorical.lastPrice,
                    high: latestHistorical.high || latestHistorical.lastPrice,
                    low: latestHistorical.low || latestHistorical.lastPrice,
                    close: latestHistorical.lastPrice
                };
                console.log(`📊 Using synthetic OHLC from historical data`);
            }
        }
    }

    if (ltp === 0 && historicalDataLength > 0) {
        const sortedHistorical = historicalData.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const latestWithPrice = sortedHistorical.find(entry => entry.lastPrice && entry.lastPrice > 0);
        
        if (latestWithPrice && latestWithPrice.lastPrice) {
            ltp = latestWithPrice.lastPrice;
            console.log(`🔄 Final fallback to historical LTP: ${ltp} from ${latestWithPrice.date}`);
        }
    }

    if (ltp === 0) {
        console.error('❌ CRITICAL: No price data available, even from historical fallback');
        return NextResponse.json({ 
            error: `No price data available for '${tradingSymbol}'. Market may be closed.` 
        }, { status: 404 });
    }

    console.log('🎯 FINAL DATA SELECTION:', {
        source: hasLiveData ? 'LIVE' : 'HISTORICAL',
        ltp: ltp,
        volume: currentVolume,
        marketStatus: isMarketOpen ? 'OPEN' : 'CLOSED',
        dayType: isTradingDay ? 'TRADING_DAY' : 'NON_TRADING_DAY'
    });

    // Add price verification
    const actualChange = await verifyPriceData(kc, tradingSymbol, exchange);
    
    // FIXED: Use the new calculateChangePercent function with proper parameters
    const changePercent = await calculateChangePercent(ltp, historicalData, 'CMP', kc, tradingSymbol, exchange);

    // --- NEW: Relative Strength vs Nifty — the gap between the stock's
    // own % move and the index's % move on the same day. A stock down
    // 0.5% reads very differently if Nifty is down 2% (relative strength)
    // vs if Nifty is up 1% (genuine underperformance) — this metric
    // makes that distinction explicit instead of leaving it invisible.
    const relativeStrengthGap = niftyDataAvailable ? (changePercent - niftyChangePercent) : 0;
    const relativeStrengthLabel = !niftyDataAvailable
      ? null
      : relativeStrengthGap > 1 ? 'Outperforming'
      : relativeStrengthGap < -1 ? 'Underperforming'
      : 'In line with market';
    
    console.log(`🔍 ${displayName} ACTUAL VS CALCULATED:`, {
      actualZerodhaChange: actualChange,
      ourCalculatedChange: changePercent,
      discrepancy: actualChange !== null ? Math.abs(actualChange - changePercent) : 'N/A'
    });

    const volumeMetrics = calculateVolumeMetrics(historicalData, currentVolume, shouldUseHistorical,hours,minutes);

    // === ADD DATA SUFFICIENCY CHECK ===
    const dataSufficiency = {
        isFullySufficient: historicalDataLength >= 14,
        totalDaysCollected: historicalDataLength,
        indicators: {
            volume: { 
                collected: historicalDataLength, 
                required: 5, 
                isReady: historicalDataLength >= 5 
            },
            adAnalysis: { 
                collected: historicalDataLength, 
                required: 10, 
                isReady: historicalDataLength >= 10 
            },
            rsi: { 
                collected: historicalDataLength, 
                required: 14, 
                isReady: historicalDataLength >= 14 
            },
            vwap: { 
                collected: Math.max(historicalDataLength, 1), 
                required: 1, 
                isReady: true
            },
            pcr: { 
                collected: Math.max(historicalDataLength, 1), 
                required: 1, 
                isReady: true
            }
        }
    };

    console.log('📊 DATA SUFFICIENCY CHECK:', {
        daysCollected: historicalDataLength,
        volumeAnalysis: dataSufficiency.indicators.volume.isReady ? 'READY' : `NEEDS ${5 - historicalDataLength} MORE DAYS`,
        adAnalysis: dataSufficiency.indicators.adAnalysis.isReady ? 'READY' : `NEEDS ${10 - historicalDataLength} MORE DAYS`,
        rsiAnalysis: dataSufficiency.indicators.rsi.isReady ? 'READY' : `NEEDS ${14 - historicalDataLength} MORE DAYS`
    });
    // === END DATA SUFFICIENCY CHECK ===
    
    console.log('🔍 ANALYSIS DEBUG - Volume metrics:', {
      ...volumeMetrics,
      hasAvg: volumeMetrics.avg20DayVolume > 0,
      hasTodayPercent: volumeMetrics.todayVolumePercentage > 0
    });

    console.log('📊 A/D ANALYSIS - Starting calculation...');
    
    let adAnalysis: ADAnalysis;
    // --- FIX: shared flag, set in either the "zero money flow" branch or
    // the "insufficient data" branch below, so the API response can be
    // honest about when today's A/D signal isn't based on real live data.
    let adTodaySignalUnavailable = false;
    try {
      let todayData: { high: number; low: number; close: number; volume: number } | undefined = undefined;
      
      if (todayOHLC && todayOHLC.high > 0 && todayOHLC.low > 0 && ltp > 0) {
        todayData = {
          high: Math.max(todayOHLC.high, ltp),
          low: Math.min(todayOHLC.low, ltp),
          close: ltp,
          volume: currentVolume || 0
        };
        
        console.log('📊 A/D ANALYSIS - Using live OHLC data:', todayData);
      } else if (historicalDataLength > 0) {
        const latestHistorical = historicalData[historicalDataLength - 1];
        if (latestHistorical && latestHistorical.lastPrice && latestHistorical.lastPrice > 0) {
          todayData = {
            high: latestHistorical.lastPrice,
            low: latestHistorical.lastPrice, 
            close: latestHistorical.lastPrice,
            volume: currentVolume || latestHistorical.totalVolume || 0
          };
          console.log('📊 A/D ANALYSIS - Using historical data as proxy:', todayData);
        }
      }

      console.log('📊 A/D ANALYSIS - Data prepared:', {
        hasTodayData: !!todayData,
        todayData,
        historicalDataLength: historicalDataLength,
        hasValidOHLC: todayOHLC ? (todayOHLC.high > 0 && todayOHLC.low > 0) : false
      });

      if (historicalDataLength >= 1) {
        adAnalysis = generateADAnalysis(displayName.toUpperCase(), historicalData, todayData);
        
        // --- FIX: this used to fabricate a money flow value whenever the
        // real calculation legitimately returned zero (which happens when
        // live intraday OHLC is unavailable, forcing high===low). The old
        // fallback (`volumeEstimate * ltp * 0.15`) was ALWAYS POSITIVE —
        // every single time it fired, it forced "ACCUMULATION" regardless
        // of what was actually happening with the stock, a deterministic
        // bullish bias, not just noise. Now we're honest instead: mark
        // today's signal as unavailable, and lean on the multi-day
        // `trend` field, which is built from genuine historical EOD data
        // with no fabrication at all.
        // (uses the shared adTodaySignalUnavailable flag declared above)
        if (adAnalysis.todayMoneyFlow === 0) {
          console.log('⚠️ A/D: today\'s live intraday data unavailable — marking as unavailable, not fabricating a signal');
          adTodaySignalUnavailable = true;
          adAnalysis.todaySignal = 'NEUTRAL';
          adAnalysis.todayStrength = 'WEAK';
          adAnalysis.interpretation = "Today's signal unavailable (live intraday data missing) — see multi-day trend instead";
        }
        if (adAnalysis.twentyDayAverage === 0) {
          adAnalysis.twentyDayAverage = 0; // honest zero, not a fabricated estimate
        }
        
        console.log('📊 A/D ANALYSIS - Result:', {
          signal: adAnalysis.todaySignal,
          strength: adAnalysis.todayStrength,
          moneyFlow: adAnalysis.todayMoneyFlow,
          trend: adAnalysis.trend,
          confidence: adAnalysis.confidence
        });
      } else {
        console.log('📊 A/D ANALYSIS - Skipped: Insufficient historical data');
        // --- FIX: previously fabricated todayMoneyFlow, twentyDayAverage,
        // currentADLine, and previousADLine using avg20DayVolume * ltp *
        // a fixed multiplier — invented numbers dressed up as real
        // analysis when there simply isn't enough data yet. Now honestly
        // zeroed out instead, with adTodaySignalUnavailable flagging this
        // to the response/UI.
        adTodaySignalUnavailable = true;
        adAnalysis = {
          todaySignal: 'NEUTRAL',
          todayStrength: 'WEAK',
          todayMoneyFlow: 0,
          twentyDayAverage: 0,
          avgDaysUsed: 0,
          trend: 'SIDEWAYS',
          confidence: 'LOW',
          trendDaysUsed: 0,
          // --- FIX: these 4 fields were missing entirely, causing a
          // runtime crash (500 error) whenever this fallback path ran —
          // adAnalysis.trendStrengthPct.toFixed(1) throws on undefined.
          overallTrend: 'NEUTRAL',
          trendStrengthPct: 0,
          trendStrengthLabel: 'Neutral',
          overallTrendDaysUsed: 0,
          breakdown: {
            currentADLine: 0,
            previousADLine: 0,
            change: 0,
            changePercent: 0
          },
          volumeAnalysis: {
            todayVolume: currentVolume || 0,
            volumeVsAverage: 0,
            volumeConfirmation: 'NO'
          },
          interpretation: 'Insufficient historical data for A/D analysis — signal unavailable'
        } as ADAnalysis;
      }
    } catch (error) {
      console.error('❌ A/D ANALYSIS - Error:', error);
      // --- FIX: found a THIRD fabrication instance here — same
      // avg20DayVolume * ltp * 0.1 pattern as the other two we already
      // fixed. An error genuinely occurred; honestly zero instead of
      // inventing plausible-looking numbers.
      adTodaySignalUnavailable = true;
      adAnalysis = {
        todaySignal: 'NEUTRAL',
        todayStrength: 'WEAK', 
        todayMoneyFlow: 0,
        twentyDayAverage: 0,
        avgDaysUsed: 0,
        trend: 'SIDEWAYS',
        confidence: 'LOW',
        trendDaysUsed: 0,
        // --- FIX: same missing fields, same crash, second location
        overallTrend: 'NEUTRAL',
        trendStrengthPct: 0,
        trendStrengthLabel: 'Neutral',
        overallTrendDaysUsed: 0,
        breakdown: {
          currentADLine: 0,
          previousADLine: 0,
          change: 0,
          changePercent: 0
        },
        volumeAnalysis: {
          todayVolume: currentVolume || 0,
          volumeVsAverage: 0,
          volumeConfirmation: 'NO'
        },
        interpretation: 'A/D analysis failed: ' + (error instanceof Error ? error.message : 'Unknown error')
      } as ADAnalysis;
    }

    console.log('📊 RSI ANALYSIS - Starting calculation...');
    const rsiAnalysis = calculateRSI(historicalData, 14);
    console.log('📊 RSI ANALYSIS - Result:', rsiAnalysis);

    console.log('📊 VWAP ANALYSIS - Starting calculation...');
    const vwapAnalysis = calculateVWAP(
      ltp, 
      currentVolume, 
      historicalData, 
      todayOHLC || null,
      isMarketOpen,
      hours,
      minutes
    );
    console.log('📊 VWAP ANALYSIS - Result:', vwapAnalysis);

    console.log('📊 OPTIONS DATA - Fetching quote data for options chain...');
    const instrumentTokens = optionsChain.map((o: Instrument) => `NFO:${o.tradingsymbol}`);
    const quoteData: QuoteData = await kc.getQuote(instrumentTokens);

    const optionsByStrike: Record<number, { ce_oi: number, pe_oi: number }> = {};
    const strikePrices = [...new Set(optionsChain.map(o => o.strike))].sort((a, b) => a - b);
    
    let totalCallOI = 0, totalPutOI = 0, totalCallVolume = 0, totalPutVolume = 0;
    let highestCallOI = 0, highestPutOI = 0;

    console.log('📊 OPTIONS DATA - Processing strikes...');
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
        
        if (strike > ltp && ce_oi > highestCallOI) highestCallOI = ce_oi;
        if (strike < ltp && pe_oi > highestPutOI) highestPutOI = pe_oi;
    }

    let pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 0; 
    let volumePcr = totalCallVolume > 0 ? totalPutVolume / totalCallVolume : 0;
    // --- FIX: transparency flags so the UI can show when volumePcr is a
    // real-OI-based proxy or a genuine no-data neutral, instead of silently
    // blending estimated numbers in as if they were live trading volume.
    let volumePcrIsEstimated = false;
    let volumePcrEstimateReason = '';

    console.log('📊 PCR CALCULATION - Initial values:', { pcr, volumePcr, totalCallOI, totalPutOI });

    if (volumePcr === 0 || volumePcr === 1.0) {
        console.log('🔄 Volume PCR is 0/1, applying comprehensive fallback strategies...');
        
        const dailyDataStr = await getRedisData('daily_sentiment_data');
        if (dailyDataStr) {
            const dailyData: Record<string, any> = JSON.parse(dailyDataStr);
            const symbolData = dailyData[displayName.toUpperCase()];
            if (symbolData && symbolData.volumePcr && symbolData.volumePcr !== 0 && symbolData.volumePcr !== 1.0) {
                volumePcr = symbolData.volumePcr;
                console.log(`📊 Using stored volume PCR: ${volumePcr}`);
            }
        }
        
        // --- FIX: removed random-number fallbacks (getWeekendVolumePCR,
        // getHolidayVolumePCR, getAfterHoursVolumePCR all used Math.random()
        // to fabricate a plausible-looking PCR when no real volume data was
        // available — feeding synthetic numbers into the same sentiment
        // score as real data, with no indication to the user which was which.
        //
        // The OI-based `pcr` is genuinely real in all these cases (Kite's
        // quote API returns the last real exchange-published OI even when
        // markets are closed) — so we now use that as an honest proxy for
        // ALL non-trading-volume situations, not just "market open but
        // volume missing". If OI itself isn't usable either, we mark the
        // reading explicitly as estimated rather than inventing a number.
        if ((volumePcr === 0 || volumePcr === 1.0)) {
            if (pcr > 0 && pcr !== 1.0) {
                volumePcr = pcr;
                volumePcrIsEstimated = true;
                volumePcrEstimateReason = isMarketOpen
                    ? 'Live trading volume unavailable — using real OI-based PCR as proxy'
                    : isWeekend
                    ? 'Market closed (weekend) — using last real OI-based PCR as proxy'
                    : isMarketHoliday
                    ? 'Market closed (holiday) — using last real OI-based PCR as proxy'
                    : 'Outside trading hours — using last real OI-based PCR as proxy';
                console.log(`📊 Using real OI PCR as volume proxy: ${volumePcr} (${volumePcrEstimateReason})`);
            } else {
                // No usable OI data either — be honest about it instead of
                // guessing from price direction. Neutral (1.0) contributes
                // zero to the sentiment score rather than fabricating a lean.
                volumePcr = 1.0;
                volumePcrIsEstimated = true;
                volumePcrEstimateReason = 'No real volume or OI data available — showing neutral, not a guess';
                console.log(`📊 No usable OI/volume data — defaulting to neutral (not randomized): ${volumePcr}`);
            }
        }
    }

    const reasonableMin = isMarketOpen ? 0.3 : 0.1;
    const reasonableMax = isMarketOpen ? 3.0 : 5.0;
    if (volumePcr <= reasonableMin || volumePcr >= reasonableMax) {
        console.log('🔄 Volume PCR out of reasonable range, normalizing...');
        volumePcr = Math.min(Math.max(volumePcr, reasonableMin), reasonableMax);
        console.log(`📊 Normalized volume PCR: ${volumePcr}`);
    }

    if (pcr === 0) {
        pcr = totalPutOI > 0 ? 999 : 1.0;
        console.log(`📊 Zero PCR handled: ${pcr}`);
    }

    console.log('📊 FINAL PCR VALUES:', { 
        pcr: parseFloat(pcr.toFixed(3)), 
        volumePcr: parseFloat(volumePcr.toFixed(3)),
        marketCondition: isMarketOpen ? 'MARKET_OPEN' : isWeekend ? 'WEEKEND' : isMarketHoliday ? 'HOLIDAY' : 'AFTER_HOURS'
    });

    // Save OI data for future trend analysis
    try {
      await storeOIData(displayName.toUpperCase(), optionsByStrike);
    } catch (error) {
      console.error('❌ Error storing OI data:', error);
      // Continue execution even if OI storage fails
    }

    const { supports: supportLevels, resistances: resistanceLevels } = await getFinalLevels(
      displayName.toUpperCase(), 
      historicalData, 
      ltp, 
      optionsByStrike, 
      strikePrices
    );

    const finalSupport = supportLevels.length > 0 ? supportLevels[0].price : 0;
    const finalResistance = resistanceLevels.length > 0 ? resistanceLevels[0].price : 0;

    // --- FIX: Max Pain calculation MOVED to before the sentiment call
    // (was previously calculated AFTER calculateSmartSentiment ran, so it
    // could never be included in the score — it was purely a display-only
    // number with zero weight in the composite sentiment, even though the
    // theory behind it is directly relevant to directional bias).
    console.log('📊 MAX PAIN - Calculating...');
    let minLoss = Infinity, maxPain = 0;
    for (const expiryStrike of strikePrices) {
        let totalLoss = 0;
        for (const strike of strikePrices) {
            const option = optionsByStrike[strike] || { ce_oi: 0, pe_oi: 0 };
            if (option.ce_oi > 0 && expiryStrike > strike) totalLoss += (expiryStrike - strike) * option.ce_oi;
            if (option.pe_oi > 0 && expiryStrike < strike) totalLoss += (strike - expiryStrike) * option.pe_oi;
        }
        if (totalLoss < minLoss) { minLoss = totalLoss; maxPain = expiryStrike; }
    }
    console.log(`📊 MAX PAIN: ${maxPain} (Min Loss: ${minLoss})`);

    const sentimentResult = calculateSmartSentiment(
        pcr,
        volumePcr,
        highestPutOI,
        highestCallOI,
        volumeMetrics.todayVolumePercentage,
        volumeMetrics.estimatedTodayVolume, 
        volumeMetrics.avg20DayVolume,
        adAnalysis,
        // --- FIX: adTodaySignalUnavailable removed from here — it was
        // never actually used inside calculateSmartSentiment's body, and
        // passing it as a positional argument silently shifted EVERY
        // parameter after it by one slot, which is what broke maxPain
        // and currentPrice (they were receiving volumePcrIsEstimated's
        // and maxPain's values respectively, instead of their own). The
        // API response already gets adTodaySignalUnavailable directly
        // from the outer-scope variable — no need to route it through
        // this function at all.
        vwapAnalysis,
        isMarketOpen,
        changePercent,
        historicalDataLength,
        volumePcrIsEstimated, // --- FIX: needed to detect and avoid double-counting when volumePcr is just a copy of pcr
        maxPain, // --- NEW: 7th weighted component
        ltp,     // --- NEW: current price, to compare against maxPain
        relativeStrengthGap, // --- NEW: 8th weighted component, added at the END per lesson learned
        niftyDataAvailable
    );
    
    const formattedExpiry = new Date(nearestExpiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');

    const formatMoneyFlow = (flow: number) => {
      if (Math.abs(flow) >= 1000000) return `${(flow / 1000000).toFixed(1)}M`;
      if (Math.abs(flow) >= 1000) return `${(flow / 1000).toFixed(1)}K`;
      return flow.toFixed(0);
    };

    const getStrengthColor = (strength: string, type: 'support' | 'resistance') => {
      if (type === 'support') {
        switch (strength.toUpperCase()) {
          case 'STRONG': return '#10b981'; // Green
          case 'MEDIUM': return '#f59e0b'; // Orange
          case 'WEAK': return '#ef4444';   // Red
          default: return '#6b7280';
        }
      } else {
        // Resistance - opposite colors
        switch (strength.toUpperCase()) {
          case 'STRONG': return '#ef4444'; // Red
          case 'MEDIUM': return '#f59e0b'; // Orange
          case 'WEAK': return '#10b981';   // Green
          default: return '#6b7280';
        }
      }
    };

    const getSignalColor = (signal: string) => {
      switch (signal.toUpperCase()) {
        case 'ACCUMULATION': return '#10b981';
        case 'DISTRIBUTION': return '#ef4444';
        case 'NEUTRAL': return '#6b7280';
        default: return '#6b7280';
      }
    };

    const getRSIColor = (rsiValue: number | null) => {
      if (rsiValue === null) return '#6b7280';
      if (rsiValue >= 70) return '#ef4444';
      if (rsiValue <= 30) return '#10b981';
      if (rsiValue > 50) return '#3b82f6';
      return '#f59e0b';
    };

    const getRSISignalColor = (signal: string) => {
      switch (signal.toUpperCase()) {
        case 'OVERBOUGHT': return '#ef4444';
        case 'OVERSOLD': return '#10b981';
        case 'BULLISH': return '#3b82f6';
        case 'BEARISH': return '#f59e0b';
        case 'NEUTRAL': return '#6b7280';
        default: return '#6b7280';
      }
    };

    const getVWAPSignalColor = (signal: string) => {
      switch (signal.toUpperCase()) {
        case 'BULLISH': return '#10b981';
        case 'BEARISH': return '#ef4444';
        case 'NEUTRAL': return '#6b7280';
        default: return '#6b7280';
      }
    };

    const getVWAPStrengthColor = (strength: string) => {
      switch (strength.toUpperCase()) {
        case 'STRONG': return '#10b981';
        case 'MODERATE': return '#f59e0b';
        case 'WEAK': return '#6b7280';
        default: return '#6b7280';
      }
    };

    console.log('🔍 FINAL ANALYSIS DEBUG:', {
      symbol: displayName,
      ltp: ltp,
      changePercent: changePercent,
      volumePcr: volumePcr,
      sentiment: sentimentResult.sentiment,
      score: sentimentResult.score,
      pcr: pcr,
      dataSource: hasLiveData ? 'LIVE' : 'HISTORICAL',
      marketStatus: isMarketOpen ? 'OPEN' : 'CLOSED'
    });

    const responseData = {
        symbol: displayName.toUpperCase(),
        ltp: ltp,
        priceType: 'CMP',
        lastRefreshed: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }),
        changePercent: parseFloat(changePercent.toFixed(2)),
        // --- NEW: Relative Strength vs Nifty, for header display (Option B)
        niftyChangePercent: niftyDataAvailable ? parseFloat(niftyChangePercent.toFixed(2)) : null,
        relativeStrengthGap: niftyDataAvailable ? parseFloat(relativeStrengthGap.toFixed(2)) : null,
        relativeStrengthLabel: relativeStrengthLabel,
        avg20DayVolume: volumeMetrics.avg20DayVolume,
        todayVolumePercentage: volumeMetrics.todayVolumePercentage,
        estimatedTodayVolume: volumeMetrics.estimatedTodayVolume,
        dataSufficiency: dataSufficiency,
        insufficientData: !dataSufficiency.isFullySufficient,
        expiryDate: formattedExpiry,
        sentiment: sentimentResult.sentiment,
        sentimentScore: sentimentResult.score,
        sentimentBreakdown: sentimentResult.breakdown,
        pcr: parseFloat(pcr.toFixed(2)),
        volumePcr: parseFloat(volumePcr.toFixed(2)),
        // --- FIX: exposes whether volumePcr is real live trading volume or
        // an estimated proxy (real OI data or neutral fallback), instead of
        // silently presenting estimated numbers as if they were live.
        volumePcrIsEstimated,
        volumePcrEstimateReason: volumePcrIsEstimated ? volumePcrEstimateReason : undefined,
        maxPain,
        maxPainSentiment: sentimentResult.maxPainSentiment, // --- NEW: {label, color} for the UI card, or undefined if no valid data
        support: finalSupport, 
        resistance: finalResistance,
        supports: supportLevels.map(level => ({
          ...level,
          styling: {
            strengthColor: getStrengthColor(level.strength, 'support')
          }
        })),
        resistances: resistanceLevels.map(level => ({
          ...level,
          styling: {
            strengthColor: getStrengthColor(level.strength, 'resistance')
          }
        })),
        marketStatus: isMarketOpen ? 'OPEN' : 'CLOSED',
        dataSource: hasLiveData ? 'LIVE' : 'HISTORICAL',
        
        adAnalysis: {
            todaySignal: adAnalysis.todaySignal,
            todayStrength: adAnalysis.todayStrength,
            trend: adAnalysis.trend,
            confidence: adAnalysis.confidence,
            
            styling: {
                signalColor: getSignalColor(adAnalysis.todaySignal),
                strengthColor: getStrengthColor(adAnalysis.todayStrength, 'support'),
                trendIcon: adAnalysis.trend.toUpperCase() === 'BULLISH' ? '📈' : 
                          adAnalysis.trend.toUpperCase() === 'BEARISH' ? '📉' : '➡️',
                confidenceIcon: adAnalysis.confidence === 'HIGH' ? '🎯' : adAnalysis.confidence === 'MEDIUM' ? '🎯' : '🎯'
            },
            
            display: {
                signal: `${adAnalysis.todaySignal} (${adAnalysis.todayStrength})`,
                moneyFlow: adAnalysis.avgDaysUsed >= 20
                  ? `${adAnalysis.todayMoneyFlow >= 0 ? '+' : ''}${formatMoneyFlow(adAnalysis.todayMoneyFlow)} vs ${formatMoneyFlow(adAnalysis.twentyDayAverage)} (20 days average)`
                  : `${adAnalysis.todayMoneyFlow >= 0 ? '+' : ''}${formatMoneyFlow(adAnalysis.todayMoneyFlow)}`,
                trend: `${adAnalysis.trend}`,
                confidence: `${adAnalysis.confidence}`,
                // --- NEW: EMA-based overall trend, from the n8n flow's methodology
                overallTrend: `${adAnalysis.overallTrend} (${(adAnalysis.trendStrengthPct ?? 0).toFixed(1)}%, ${adAnalysis.trendStrengthLabel})`,
                interpretation: `${adAnalysis.interpretation}`
            },
            
            // --- FIX: re-added the interpretation line, but this time it's
            // the NEW 3-input combined synthesis (Recent Momentum + Overall
            // Trend + Today's Flow), not the old sentence that was purely
            // redundant with the "Today's Signal" badge above. This one
            // genuinely adds new information — specifically whether the
            // two trend measures agree or disagree with each other.
            formattedLines: [
                // --- FIX: both lines now require a genuine FULL 20 days
                // before showing the average/trend comparison. Below
                // that threshold, showing "vs X average" or a confident
                // BULLISH/BEARISH/SIDEWAYS verdict would be misleading —
                // an "average" of a couple of days isn't meaningful, and
                // a trend comparison run on too little data isn't a real
                // finding. Show today's raw value / a clear "still
                // collecting" message instead until 20 real days exist.
                adAnalysis.avgDaysUsed >= 20
                  ? `💰 Today's Money Flow: ${adAnalysis.todayMoneyFlow >= 0 ? '+' : ''}${formatMoneyFlow(adAnalysis.todayMoneyFlow)} vs ${formatMoneyFlow(adAnalysis.twentyDayAverage)} (20 days average)`
                  : `💰 Today's Money Flow: ${adAnalysis.todayMoneyFlow >= 0 ? '+' : ''}${formatMoneyFlow(adAnalysis.todayMoneyFlow)}`,
                // --- FIX: relabeled from "20-Day Trend" to "Recent 10-Day
                // Momentum" — this is a 10-vs-10 day comparison, genuinely
                // distinct from the new EMA-based "Overall Trend" line below.
                adAnalysis.trendDaysUsed >= 20
                  ? `📊 Recent 10-Day Momentum: ${adAnalysis.trend}`
                  : `📊 Recent 10-Day Momentum: Data collection underway (${adAnalysis.trendDaysUsed}/20 days)`,
                // --- NEW: EMA-based overall trend line
                (adAnalysis.overallTrendDaysUsed ?? 0) >= 20
                  ? `📈 Overall Trend vs. Baseline: ${adAnalysis.overallTrend} (${(adAnalysis.trendStrengthPct ?? 0) >= 0 ? '+' : ''}${(adAnalysis.trendStrengthPct ?? 0).toFixed(1)}%, ${adAnalysis.trendStrengthLabel})`
                  : `📈 Overall Trend vs. Baseline: Data collection underway (${adAnalysis.overallTrendDaysUsed ?? 0}/20 days)`,
                ``,
                `💡 ${adAnalysis.interpretation}`,
            ],
            
            raw: {
                todayMoneyFlow: adAnalysis.todayMoneyFlow,
                twentyDayAverage: adAnalysis.twentyDayAverage,
                todayVolume: adAnalysis.volumeAnalysis.todayVolume,
                volumeVsAverage: adAnalysis.volumeAnalysis.volumeVsAverage,
                volumeConfirmation: adAnalysis.volumeAnalysis.volumeConfirmation
            },
            
            breakdown: adAnalysis.breakdown,
            volumeAnalysis: adAnalysis.volumeAnalysis,
            interpretation: adAnalysis.interpretation
        },

        rsiAnalysis: {
            value: rsiAnalysis.value,
            signal: rsiAnalysis.signal,
            strength: rsiAnalysis.strength,
            interpretation: rsiAnalysis.interpretation,
            period: 14,
            levels: {
                overbought: 70,
                oversold: 30,
                neutral: 50
            },
            styling: {
                valueColor: getRSIColor(rsiAnalysis.value),
                signalColor: getRSISignalColor(rsiAnalysis.signal),
                strengthColor: getStrengthColor(rsiAnalysis.strength, 'support'),
                trendIcon: rsiAnalysis.signal === 'BULLISH' ? '📈' : 
                          rsiAnalysis.signal === 'BEARISH' ? '📉' : '➡️'
            },
            display: {
                value: rsiAnalysis.value !== null ? `RSI(14): ${rsiAnalysis.value}` : 'RSI: Insufficient Data',
                signal: `${rsiAnalysis.signal} ${rsiAnalysis.strength !== 'NEUTRAL' ? `(${rsiAnalysis.strength})` : ''}`.trim(),
                interpretation: rsiAnalysis.interpretation,
                zone: rsiAnalysis.value !== null ? 
                      (rsiAnalysis.value >= 70 ? 'OVERBOUGHT' : rsiAnalysis.value <= 30 ? 'OVERSOLD' : 'NEUTRAL') : 
                      'NO_DATA'
            }
        },

        vwapAnalysis: {
            value: vwapAnalysis.value,
            typicalPrice: vwapAnalysis.typicalPrice,
            cumulativeVolume: vwapAnalysis.cumulativeVolume,
            deviationPercent: vwapAnalysis.deviationPercent,
            signal: vwapAnalysis.signal,
            strength: vwapAnalysis.strength,
            interpretation: vwapAnalysis.interpretation,
            
            styling: {
                valueColor: getVWAPSignalColor(vwapAnalysis.signal),
                signalColor: getVWAPSignalColor(vwapAnalysis.signal),
                strengthColor: getVWAPStrengthColor(vwapAnalysis.strength),
                trendIcon: vwapAnalysis.signal === 'BULLISH' ? '📈' : 
                          vwapAnalysis.signal === 'BEARISH' ? '📉' : '➡️'
            },
            
            display: {
                value: vwapAnalysis.value !== null ? `VWAP: ₹${vwapAnalysis.value.toFixed(2)}` : 'VWAP: Calculating...',
                signal: `${vwapAnalysis.signal} ${vwapAnalysis.strength !== 'WEAK' ? `(${vwapAnalysis.strength})` : ''}`.trim(),
                deviation: `${vwapAnalysis.deviationPercent >= 0 ? '+' : ''}${vwapAnalysis.deviationPercent.toFixed(2)}%`,
                interpretation: vwapAnalysis.interpretation,
                position: vwapAnalysis.deviationPercent > 0 ? 'ABOVE_VWAP' : vwapAnalysis.deviationPercent < 0 ? 'BELOW_VWAP' : 'AT_VWAP'
            },
            
            formattedLines: [
                `💰 Current VWAP: ₹${vwapAnalysis.value?.toFixed(2) || 'Calculating...'}`,
                                `📈 LTP vs VWAP: ${vwapAnalysis.deviationPercent >= 0 ? '+' : ''}${vwapAnalysis.deviationPercent.toFixed(2)}% ${vwapAnalysis.deviationPercent > 0 ? 'ABOVE' : vwapAnalysis.deviationPercent < 0 ? 'BELOW' : 'AT'}`,
                `📦 Cumulative Volume: ${(vwapAnalysis.cumulativeVolume / 1000).toFixed(1)}K shares`,
                `🎯 Signal: ${vwapAnalysis.signal} ${vwapAnalysis.strength !== 'WEAK' ? `(${vwapAnalysis.strength})` : ''}`,
                ``,
                `💡 ${vwapAnalysis.interpretation}`
            ]
        }
    };
    
    // --- NEW: save this result to the short-lived cache (45s TTL) before
    // returning it, so the next request for this same symbol within that
    // window gets an instant cached response instead of hitting Kite again.
    try {
      const client = createClient({ url: process.env.REDIS_URL });
      await client.connect();
      await client.setEx(cacheKey, 45, JSON.stringify(responseData));
      await client.quit();
      console.log(`💾 Cached analysis for ${displayName} (45s TTL)`);
    } catch (cacheError) {
      console.error('⚠️ Cache write failed (non-fatal, response still returned normally):', cacheError);
    }

    console.log('✅ API CALL COMPLETED SUCCESSFULLY ========================');
    return NextResponse.json(responseData);

  } catch (error) {
    const err = error as Error & { error_type?: string };
    console.error("❌ API ERROR:", {
        message: err.message,
        stack: err.stack,
        errorType: err.error_type,
        timestamp: new Date().toISOString()
    });
    
    if (err.error_type === 'TokenException') {
        return NextResponse.json({ error: 'Kite token has expired. Please run the login script again.' }, { status: 401 });
    }
    return NextResponse.json({ error: 'An error occurred fetching data.' }, { status: 500 });
  }
}