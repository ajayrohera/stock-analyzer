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

// FIXED: Enhanced HistoricalData interface with proper OHLC structure
interface HistoricalData {
  date: string; // YYYY-MM-DD format
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi?: number;
  symbol?: string;
  
  // Backward compatibility aliases
  lastPrice?: number; // Alias for close
  totalVolume?: number; // Alias for volume
  name?: string; // Alias for symbol
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
  displayStrength?: string;
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

// FIXED: Enhanced Redis helper with better error handling
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

// FIXED: Store data in Redis with proper structure
async function setRedisData(key: string, data: any, expirySeconds: number = 2592000): Promise<void> {
  const client = createClient({ url: process.env.REDIS_URL });
  try {
    await client.connect();
    await client.set(key, JSON.stringify(data), { EX: expirySeconds });
    console.log(`💾 REDIS: Stored data for key "${key}"`);
  } catch (error) {
    console.error(`❌ REDIS ERROR: Failed to set key "${key}":`, error);
  } finally {
    await client.quit().catch(err => console.error('Redis quit error:', err));
  }
}

// FIXED: Store OI data in Redis
async function storeOIData(symbol: string, optionsByStrike: Record<number, { ce_oi: number, pe_oi: number }>): Promise<void> {
  const client = createClient({ url: process.env.REDIS_URL });
  try {
    await client.connect();
    
    const oiHistoryKey = `oi_history_${symbol.toUpperCase()}`;
    const timestamp = new Date().toISOString();
    
    const existingData = await client.get(oiHistoryKey);
    const oiHistory = existingData ? JSON.parse(existingData) : {};
    
    oiHistory[timestamp] = {};
    
    for (const [strike, oiData] of Object.entries(optionsByStrike)) {
      oiHistory[timestamp][strike] = {
        ce_oi: oiData.ce_oi,
        pe_oi: oiData.pe_oi
      };
    }
    
    const timestamps = Object.keys(oiHistory).sort();
    if (timestamps.length > 30) {
      const oldestTimestamps = timestamps.slice(0, timestamps.length - 30);
      oldestTimestamps.forEach(oldTimestamp => {
        delete oiHistory[oldTimestamp];
      });
    }
    
    await client.set(oiHistoryKey, JSON.stringify(oiHistory), { EX: 2592000 });
    console.log(`💾 OI data stored for ${symbol} with ${Object.keys(oiHistory).length} timestamps`);
  } catch (error) {
    console.error('❌ Error storing OI data:', error);
  } finally {
    await client.quit().catch(err => console.error('Redis quit error:', err));
  }
}

// NEW: Store VWAP data in Redis
async function storeVWAPData(symbol: string, vwapData: any): Promise<void> {
  await setRedisData(`vwap_data_${symbol.toUpperCase()}`, vwapData, 86400);
}

// NEW: Get VWAP data from Redis
async function getVWAPData(symbol: string): Promise<any> {
  const data = await getRedisData(`vwap_data_${symbol.toUpperCase()}`);
  return data ? JSON.parse(data) : null;
}

// NEW: Enhanced Historical Data Storage System
async function storeHistoricalData(symbol: string, data: HistoricalData): Promise<void> {
  try {
    const key = `historical_${symbol.toUpperCase()}`;
    const existingData = await getHistoricalDataEnhanced(symbol);
    
    // Check if we already have data for this date
    const existingIndex = existingData.findIndex(d => d.date === data.date);
    
    let updatedData: HistoricalData[];
    if (existingIndex >= 0) {
      // Update existing entry
      updatedData = [...existingData];
      updatedData[existingIndex] = {
        ...updatedData[existingIndex],
        ...data,
        timestamp: Math.max(updatedData[existingIndex].timestamp, data.timestamp)
      };
      console.log(`📊 Updated historical data for ${symbol} on ${data.date}`);
    } else {
      // Add new entry
      updatedData = [...existingData, data];
      console.log(`📊 Added new historical data for ${symbol} on ${data.date}`);
    }
    
    // Sort by date (oldest first)
    updatedData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    // Keep last 365 days maximum
    const recentData = updatedData.slice(-365);
    
    await setRedisData(key, recentData, 2592000);
    console.log(`💾 Historical data stored for ${symbol}: ${recentData.length} days total`);
    
  } catch (error) {
    console.error('❌ Error storing historical data:', error);
  }
}

// NEW: Get enhanced historical data
async function getHistoricalDataEnhanced(symbol: string): Promise<HistoricalData[]> {
  const data = await getRedisData(`historical_${symbol.toUpperCase()}`);
  if (!data) return [];
  
  try {
    const parsedData: HistoricalData[] = JSON.parse(data);
    
    // Ensure backward compatibility
    return parsedData.map(item => ({
      ...item,
      lastPrice: item.lastPrice || item.close,
      totalVolume: item.totalVolume || item.volume,
      name: item.name || item.symbol || symbol
    }));
  } catch (error) {
    console.error('❌ Error parsing historical data:', error);
    return [];
  }
}

// NEW: Collect end-of-day data automatically
async function collectEndOfDayData(symbol: string, kite: any, exchange: string, currentPrice: number, currentVolume: number, todayOHLC: any): Promise<void> {
  try {
    const now = new Date();
    const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    const dateStr = istTime.toISOString().split('T')[0];
    
    // Check if we already have data for today
    const existingData = await getHistoricalDataEnhanced(symbol);
    const hasTodayData = existingData.some(d => d.date === dateStr);
    
    if (hasTodayData) {
      console.log(`📊 Already have EOD data for ${symbol} on ${dateStr}`);
      return;
    }
    
    // Create historical data entry
    const historicalDay: HistoricalData = {
      date: dateStr,
      timestamp: now.getTime(),
      open: todayOHLC?.open || currentPrice,
      high: todayOHLC?.high || currentPrice,
      low: todayOHLC?.low || currentPrice,
      close: currentPrice,
      volume: currentVolume || 0,
      symbol: symbol.toUpperCase(),
      lastPrice: currentPrice,
      totalVolume: currentVolume || 0,
      name: symbol.toUpperCase()
    };
    
    await storeHistoricalData(symbol, historicalDay);
    console.log(`✅ EOD data collected for ${symbol} on ${dateStr}`);
    
  } catch (error) {
    console.error(`❌ Error collecting EOD data for ${symbol}:`, error);
  }
}

// FIXED: Get historical data with fallback system
async function getHistoricalData(symbol: string): Promise<HistoricalData[]> {
  try {
    console.log(`📊 HISTORICAL DATA: Fetching for ${symbol}`);
    
    // Try enhanced historical data first
    const enhancedData = await getHistoricalDataEnhanced(symbol);
    if (enhancedData.length > 0) {
      console.log(`📊 Historical data for ${symbol}:`, {
        source: 'ENHANCED_HISTORICAL',
        entries: enhancedData.length,
        latest: enhancedData.length > 0 ? enhancedData[enhancedData.length - 1] : null
      });
      
      return enhancedData;
    }
    
    // Fallback to old volume_history data for backward compatibility
    const historyData = await getRedisData('volume_history');
    if (historyData) {
      try {
        const history: Record<string, any[]> = JSON.parse(historyData);
        const symbolData = history[symbol.toUpperCase()] || [];
        
        // Convert legacy format to new format
        const convertedData: HistoricalData[] = symbolData.map((item: any) => ({
          date: item.date || new Date().toISOString().split('T')[0],
          timestamp: item.timestamp || Date.now(),
          open: item.open || item.lastPrice || 0,
          high: item.high || item.lastPrice || 0,
          low: item.low || item.lastPrice || 0,
          close: item.close || item.lastPrice || 0,
          volume: item.volume || item.totalVolume || 0,
          lastPrice: item.lastPrice || item.close || 0,
          totalVolume: item.totalVolume || item.volume || 0,
          name: item.name || symbol,
          symbol: symbol.toUpperCase()
        }));
        
        if (convertedData.length > 0) {
          console.log(`📊 Historical data for ${symbol}:`, {
            source: 'LEGACY_VOLUME_HISTORY',
            entries: convertedData.length,
            converted: true
          });
          
          // Save converted data to new format
          for (const data of convertedData) {
            await storeHistoricalData(symbol, data);
          }
          
          return convertedData;
        }
      } catch (parseError) {
        console.error('❌ Error parsing legacy volume_history:', parseError);
      }
    }
    
    console.log(`📊 No historical data found for ${symbol} - starting fresh`);
    return [];
    
  } catch (error) { 
    console.error('❌ Error in getHistoricalData:', error); 
    return []; 
  }
}

// FIXED: VWAP Calculation Function
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
          if (day.close && day.volume) {
            totalVWAP += day.close;
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

async function getWeekendVolumePCR(symbol: string, currentTime: Date): Promise<number> {
  try {
    console.log(`🌅 WEEKEND PCR: Getting weekend-appropriate PCR for ${symbol}`);
    
    const fridayData = await getRedisData('friday_closing_data');
    if (fridayData) {
      const fridayPCRs: Record<string, number> = JSON.parse(fridayData);
      const symbolPCR = fridayPCRs[symbol.toUpperCase()];
      if (symbolPCR && symbolPCR !== 0 && symbolPCR !== 1.0) {
        console.log(`🌅 WEEKEND PCR: Using Friday's stored PCR: ${symbolPCR}`);
        return symbolPCR;
      }
    }
    
    const weekendPCR = 1.05 + (Math.random() * 0.1 - 0.05);
    console.log(`🌅 WEEKEND PCR: Using weekend default PCR: ${weekendPCR}`);
    return weekendPCR;
  } catch (error) {
    console.error('❌ Error getting weekend PCR:', error);
    return 1.05;
  }
}

async function getHolidayVolumePCR(symbol: string, currentTime: Date): Promise<number> {
  try {
    console.log(`🎄 HOLIDAY PCR: Getting holiday-appropriate PCR for ${symbol}`);
    
    const preHolidayData = await getRedisData('pre_holiday_data');
    if (preHolidayData) {
      const holidayPCRs: Record<string, number> = JSON.parse(preHolidayData);
      const symbolPCR = holidayPCRs[symbol.toUpperCase()];
      if (symbolPCR && symbolPCR !== 0 && symbolPCR !== 1.0) {
        console.log(`🎄 HOLIDAY PCR: Using pre-holiday stored PCR: ${symbolPCR}`);
        return symbolPCR;
      }
    }
    
    const holidayPCR = 1.1 + (Math.random() * 0.2 - 0.1);
    console.log(`🎄 HOLIDAY PCR: Using holiday default PCR: ${holidayPCR}`);
    return holidayPCR;
  } catch (error) {
    console.error('❌ Error getting holiday PCR:', error);
    return 1.1;
  }
}

async function getAfterHoursVolumePCR(symbol: string, oiPCR: number, currentTime: Date): Promise<number> {
  try {
    console.log(`🌙 AFTER-HOURS PCR: Getting after-hours PCR for ${symbol}`);
    
    if (oiPCR > 0 && oiPCR !== 1.0) {
      console.log(`🌙 AFTER-HOURS PCR: Using OI PCR: ${oiPCR}`);
      return oiPCR;
    }
    
    const hour = currentTime.getHours();
    let afterHoursPCR: number;
    
    if (hour >= 18 || hour < 9) {
      afterHoursPCR = 1.0 + (Math.random() * 0.3 - 0.15);
      console.log(`🌙 AFTER-HOURS PCR: Evening/overnight PCR: ${afterHoursPCR}`);
    } else {
      afterHoursPCR = 1.0 + (Math.random() * 0.2 - 0.1);
      console.log(`🌙 AFTER-HOURS PCR: Close to market open/close PCR: ${afterHoursPCR}`);
    }
    
    return afterHoursPCR;
  } catch (error) {
    console.error('❌ Error getting after-hours PCR:', error);
    return 1.0;
  }
}

function calculatePriceTrend(historicalData: HistoricalData[]): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  try {
    if (historicalData.length < 2) {
      console.log('📊 PRICE TREND: Insufficient data for trend analysis');
      return 'NEUTRAL';
    }
    
    const prices = historicalData.map(d => d.close).filter((p): p is number => p !== undefined && p > 0);
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

// FIXED: RSI Calculation Function with proper historical data
function calculateRSI(historicalData: HistoricalData[], period: number = 14): { value: number | null; signal: string; strength: string; interpretation: string } {
  console.log(`📊 RSI Calculation starting with ${historicalData.length} days of data, period: ${period}`);
  
  if (historicalData.length < period + 1) {
    const interpretation = historicalData.length === 0 
      ? 'No historical data available - collecting data'
      : `Need ${period + 1 - historicalData.length} more days for accurate RSI calculation`;
    
    console.log(`📊 RSI Insufficient data: ${interpretation}`);
    return {
      value: 50,
      signal: 'NEUTRAL',
      strength: 'LOW',
      interpretation
    };
  }

  try {
    const sortedData = [...historicalData].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    let gains: number[] = [];
    let losses: number[] = [];

    for (let i = 1; i < sortedData.length; i++) {
      const currentPrice = sortedData[i].close || 0;
      const previousPrice = sortedData[i - 1].close || 0;
      
      if (currentPrice > 0 && previousPrice > 0) {
        const change = currentPrice - previousPrice;
        gains.push(change > 0 ? change : 0);
        losses.push(change < 0 ? Math.abs(change) : 0);
      }
    }

    if (gains.length < period || losses.length < period) {
      console.log(`📊 RSI: Not enough price changes for calculation`);
      return {
        value: 50,
        signal: 'NEUTRAL',
        strength: 'LOW',
        interpretation: 'Insufficient price movement data for RSI calculation'
      };
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

// FIXED: Change percent calculation
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
    if (dayData.close && dayData.close > 0) {
      const changePercent = ((currentPrice - dayData.close) / dayData.close) * 100;
      console.log(`📊 Historical-based change: ${currentPrice} vs ${dayData.close} (${dayData.date}) = ${changePercent.toFixed(2)}%`);
      return changePercent;
    }
  }
  
  console.log('📊 No valid reference price found');
  return 0;
}

// FIXED: Price verification function
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

// FIXED: Volume metrics calculation with proper historical data
function calculateVolumeMetrics(
  historicalData: HistoricalData[], 
  currentVolume?: number, 
  isUsingHistoricalFallback: boolean = false,
  istHours?: number,
  istMinutes?: number
): {
  avg20DayVolume: number;
  todayVolumePercentage: number;
  estimatedTodayVolume: number;
} {
  console.log('📊 calculateVolumeMetrics called with:', {
    historicalDataLength: historicalData.length,
    currentVolume: currentVolume,
    isUsingHistoricalFallback: isUsingHistoricalFallback
  });
  
  // Default values for new stocks
  let result = {
    avg20DayVolume: 1000,
    todayVolumePercentage: 100,
    estimatedTodayVolume: 1000
  };
  
  if (!historicalData.length) {
    console.log('📊 No historical data available - using defaults for new stock');
    return result;
  }
  
  const dataForAverage = historicalData.filter(entry => entry.volume > 0);
  console.log('📊 Available data with volume > 0:', dataForAverage.length, 'entries');
  
  if (dataForAverage.length === 0) {
    console.log('📊 No data with volume > 0 available');
    return result;
  }
  
  const totalVolume = dataForAverage.reduce((sum, entry) => sum + entry.volume, 0);
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
    
    if (latestHistorical && latestHistorical.volume > 0) {
      const lastVolume = latestHistorical.volume;
      
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
    const oiHistoryKey = `oi_history_${symbol.toUpperCase()}`;
    const oiHistoryData = await getRedisData(oiHistoryKey);
    
    if (oiHistoryData) {
      const oiHistory: Record<string, Record<string, { ce_oi: number; pe_oi: number }>> = JSON.parse(oiHistoryData);
      
      const timestamps = Object.keys(oiHistory).sort();
      if (timestamps.length >= 2) {
        const previousTimestamp = timestamps[timestamps.length - 2];
        const previousOI = oiHistory[previousTimestamp]?.[strike]?.[instrumentType.toLowerCase() as 'ce_oi' | 'pe_oi'];
        
        if (previousOI && previousOI > 0 && currentOI > 0) {
          const changePercent = ((currentOI - previousOI) / previousOI) * 100;
          console.log(`📊 OI CHANGE: ${symbol} ${strike}${instrumentType} - ${previousOI} → ${currentOI} = ${changePercent.toFixed(1)}%`);
          return changePercent;
        }
      }
    }
    
    console.log(`📊 OI CHANGE: No historical data for ${symbol} ${strike}${instrumentType}`);
    return null;
  } catch (error) {
    console.error('❌ Error calculating OI change:', error);
    return null;
  }
}

// FIXED: OI Trend Analysis with actual change calculation
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
  const instrumentType = type === 'support' ? 'PE' : 'CE';
  const oiToTrack = type === 'support' ? mainOI : mainOI;
  
  const changePercent = await getOIChangePercent(strike, oiToTrack, instrumentType, symbol);
  
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

// FIXED: Support Levels with OI Trend Analysis
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
        
        const displayStrength = oiTrend ? `${strength} ${oiTrend.icon}` : `${strength} ➡️`;
        
        candidates.push({ 
          price: strike, 
          strength, 
          type: 'support', 
          tooltip,
          oiTrend: oiTrend || undefined,
          currentOI: { ce_oi, pe_oi },
          displayStrength
        });
      }
    }
  }
  
  console.log('🔍 OI Supports found:', candidates.map(c => `${c.price} (${c.strength})`));
  if (candidates.length === 0) return [];
  
  candidates.sort((a, b) => Math.abs(currentPrice - b.price) - Math.abs(currentPrice - a.price));
  const significantLevels = candidates.slice(0, 5);
  return significantLevels.sort((a, b) => b.price - a.price);
}

// FIXED: Resistance Levels with OI Trend Analysis
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
        
        const displayStrength = oiTrend ? `${strength} ${oiTrend.icon}` : `${strength} ➡️`;
        
        candidates.push({ 
          price: strike, 
          strength, 
          type: 'resistance', 
          tooltip,
          oiTrend: oiTrend || undefined,
          currentOI: { ce_oi, pe_oi },
          displayStrength
        });
      }
    }
  }
  
  if (candidates.length === 0) {
    console.log('🔍 RESISTANCE LEVELS: No candidates found');
    return [];
  }
  
  candidates.sort((a, b) => Math.abs(currentPrice - a.price) - Math.abs(currentPrice - b.price));
  const significantLevels = candidates.slice(0, 5);
  console.log(`🔍 RESISTANCE LEVELS: Found ${significantLevels.length} significant levels`);
  return significantLevels.sort((a, b) => a.price - b.price);
}

function calculateSupportResistance(history: HistoricalData[], currentPrice: number): SupportResistanceLevel[] {
  if (!history || history.length === 0 || !currentPrice) return [];
  
  console.log('🔍 HISTORICAL SUPPORT/RESISTANCE CALCULATION:');
  const levels: SupportResistanceLevel[] = [];
  const priceLevels = new Map<number, {volume: number, strength: 'weak' | 'medium' | 'strong'}>();
  const priceRange = currentPrice * 0.20;
  
  history.forEach(entry => {
    if (entry.close && Math.abs(entry.close - currentPrice) <= priceRange) {
      const roundedPrice = Math.round(entry.close / 5) * 5;
      const currentData = priceLevels.get(roundedPrice) || {volume: 0, strength: 'weak'};
      const newVolume = currentData.volume + (entry.volume || 0);
      
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

// FIXED: Get Final Levels - OI-ONLY with Nearest Levels First
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
  
  console.log('📊 OI-BASED SUPPORT ANALYSIS:');
  const oiSupports = await findSupportLevels(currentPrice, optionsByStrike, allStrikes, symbol);
  console.log('OI Supports found:', oiSupports.map(s => `${s.price} (${s.strength})`));
  
  console.log('📊 OI-BASED RESISTANCE ANALYSIS:');
  const oiResistances = await findResistanceLevels(currentPrice, optionsByStrike, allStrikes, symbol);
  console.log('OI Resistances found:', oiResistances.map(r => `${r.price} (${r.strength})`));

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

// FIXED: Smart sentiment with proper volume classification
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
  historicalDataLength?: number
): { sentiment: string; score: number; breakdown: string[] } {
  console.log('🧠 SENTIMENT CALCULATION:', { 
    pcr, volumePcr, highestPutOI, highestCallOI, todayVolumePercentage, changePercent, historicalDataLength
  });
  
  const dataLength = historicalDataLength || 0;
  const breakdown: string[] = [];
  
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

  let convictionScore = 0;

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

  let adScore = 0;
  let adContext = "";

  if (adAnalysis) {
    switch (adAnalysis.todaySignal) {
      case 'ACCUMULATION':
        adScore = adAnalysis.todayStrength === 'VERY_STRONG' ? 3 :
                  adAnalysis.todayStrength === 'STRONG' ? 2 :
                  adAnalysis.todayStrength === 'MODERATE' ? 1 : 1;
        adContext = ` (${adAnalysis.todayStrength.toLowerCase()} accumulation)`;
        break;
      case 'DISTRIBUTION':
        adScore = adAnalysis.todayStrength === 'VERY_STRONG' ? -3 :
                  adAnalysis.todayStrength === 'STRONG' ? -2 :
                  adAnalysis.todayStrength === 'MODERATE' ? -1 : -1;
        adContext = ` (${adAnalysis.todayStrength.toLowerCase()} distribution)`;
        break;
      case 'NEUTRAL':
      default:
        adScore = 0;
        adContext = " (neutral money flow)";
        break;
    }
  } else {
    adContext = " (data unavailable)";
  }

  let enhancedAdContext = adContext;
  if (dataLength === 0) {
    enhancedAdContext = " (new stock - data collection in progress)";
  } else if (dataLength < 10) {
    enhancedAdContext = ` (${dataLength}/10 days - limited data)`;
  }

  breakdown.push(`${adScore >= 0 ? '+' : ''}${adScore} • A/D Line${enhancedAdContext}`);

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

  let volumePercentageScore = 0;
  let volumePercentageContext = "";

  const estimatedVolumePercentage = (estimatedTodayVolume / averageVolume) * 100;
  const volumeLabel = isMarketOpen ? "Today Volume" : "Last Trading Volume";

  const bullishIndicators = (adScore > 0 ? 1 : 0) + (priceActionScore > 0 ? 1 : 0) + (vwapScore > 0 ? 1 : 0);
  const bearishIndicators = (adScore < 0 ? 1 : 0) + (priceActionScore < 0 ? 1 : 0) + (vwapScore < 0 ? 1 : 0);
  
  const hasBullishBias = bullishIndicators > bearishIndicators;
  const hasBearishBias = bearishIndicators > bullishIndicators;
  const isNeutral = bullishIndicators === bearishIndicators;

  if (estimatedVolumePercentage > 200) {
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
    if (hasBullishBias) {
      volumePercentageScore = -2;
      volumePercentageContext = isMarketOpen ? 
        ` (very low volume strongly weakens bullish conviction - projected ${estimatedVolumePercentage.toFixed(1)}% of avg)` :
        ` (very low volume strongly weakens bullish conviction)`;
    } else if (hasBearishBias) {
      volumePercentageScore = 2;
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
    if (hasBullishBias) {
      volumePercentageScore = -1;
      volumePercentageContext = isMarketOpen ? 
        ` (low volume weakens bullish conviction - projected ${estimatedVolumePercentage.toFixed(1)}% of avg)` :
        ` (low volume weakens bullish conviction)`;
    } else if (hasBearishBias) {
      volumePercentageScore = 1;
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
    volumePercentageScore = 0;
    volumePercentageContext = isMarketOpen ? 
      ` (moderate volume - projected ${estimatedVolumePercentage.toFixed(1)}% of avg)` :
      ` (moderate volume)`;
  }

  let volumeDisplayContext = volumePercentageContext;
  if (dataLength === 0) {
    volumeDisplayContext = " (new stock - data collection in progress)";
  } else if (dataLength < 5) {
    volumeDisplayContext = ` (${dataLength}/5 days - limited data)`;
  }

  breakdown.push(`${volumePercentageScore >= 0 ? '+' : ''}${volumePercentageScore} • ${volumeLabel} ${todayVolumePercentage.toFixed(1)}%${volumeDisplayContext}`);

  const weights = {
    oiPcr: 0.20,
    volumePcr: 0.15,
    adLine: 0.20,
    vwap: 0.15,
    priceAction: 0.15,
    volumePercent: 0.15,
  };

  const weightedScore = (
    (pcrScore * weights.oiPcr) +
    (volumeModifier * weights.volumePcr) +
    (adScore * weights.adLine) +
    (vwapScore * weights.vwap) +
    (priceActionScore * weights.priceAction) +
    (volumePercentageScore * weights.volumePercent)
  ) * 2;

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
    breakdown
  };
}

// NEW: Save current data as historical entry
async function saveCurrentDataAsHistorical(
  symbol: string,
  ltp: number,
  currentVolume: number,
  todayOHLC: any,
  isMarketOpen: boolean
): Promise<void> {
  try {
    const now = new Date();
    const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    const dateStr = istTime.toISOString().split('T')[0];
    
    // Get existing historical data
    const existingData = await getHistoricalData(symbol);
    const hasTodayData = existingData.some(d => d.date === dateStr);
    
    if (hasTodayData) {
      console.log(`📊 Already have data for ${symbol} on ${dateStr}`);
      return;
    }
    
    // Create historical entry from current data
    const historicalEntry: HistoricalData = {
      date: dateStr,
      timestamp: now.getTime(),
      open: todayOHLC?.open || ltp,
      high: todayOHLC?.high || ltp,
      low: todayOHLC?.low || ltp,
      close: ltp,
      volume: currentVolume || 0,
      symbol: symbol.toUpperCase(),
      lastPrice: ltp,
      totalVolume: currentVolume || 0,
      name: symbol.toUpperCase()
    };
    
    await storeHistoricalData(symbol, historicalEntry);
    console.log(`💾 Saved current data as historical for ${symbol} (Day ${existingData.length + 1})`);
    
  } catch (error) {
    console.error('❌ Error saving current data as historical:', error);
  }
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
    const allInstruments = await kc.getInstruments('NFO');
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

    try {
        const quoteDataForSymbol: QuoteData = await kc.getQuote([`${exchange}:${tradingSymbol}`]);
        ltp = quoteDataForSymbol[`${exchange}:${tradingSymbol}`]?.last_price || 0;
        currentVolume = quoteDataForSymbol[`${exchange}:${tradingSymbol}`]?.volume || 0;
        todayOHLC = quoteDataForSymbol[`${exchange}:${tradingSymbol}`]?.ohlc;
        
        console.log('💰 LIVE PRICE FETCH:', { 
            ltp, 
            currentVolume, 
            hasOHLC: !!todayOHLC,
            success: ltp > 0 
        });
    } catch (error) {
        console.log('⚠️ Live price fetch failed:', error instanceof Error ? error.message : 'Unknown error');
    }

    // FIXED: Get historical data with new enhanced system
    const historicalData = await getHistoricalData(displayName);
    const historicalDataLength = historicalData.length;
    
    console.log('🔍 HISTORICAL DATA STATUS:', {
      symbol: displayName,
      entries: historicalDataLength,
      latestEntry: historicalDataLength > 0 ? historicalData[historicalDataLength - 1] : null,
      dataCollectionStatus: historicalDataLength === 0 ? 'NEW_STOCK' : 
                           historicalDataLength < 5 ? 'EARLY_STAGE' :
                           historicalDataLength < 14 ? 'BUILDING' : 'MATURE'
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
        
        if (latestHistorical) {
            if (ltp === 0) {
                ltp = latestHistorical.close || latestHistorical.lastPrice || 0;
                console.log(`📊 Using historical LTP: ${ltp} from ${latestHistorical.date}`);
            }
            
            if (currentVolume === 0) {
                currentVolume = latestHistorical.volume || latestHistorical.totalVolume || 0;
                console.log(`📊 Using historical volume: ${currentVolume} from ${latestHistorical.date}`);
            }
            
            if (!todayOHLC && ltp > 0) {
                todayOHLC = {
                    open: latestHistorical.open || ltp,
                    high: latestHistorical.high || ltp,
                    low: latestHistorical.low || ltp,
                    close: latestHistorical.close || ltp
                };
                console.log(`📊 Using synthetic OHLC from historical data`);
            }
        }
    }

    if (ltp === 0 && historicalDataLength > 0) {
        const sortedHistorical = historicalData.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const latestWithPrice = sortedHistorical.find(entry => entry.close && entry.close > 0);
        
        if (latestWithPrice && latestWithPrice.close) {
            ltp = latestWithPrice.close;
            console.log(`🔄 Final fallback to historical LTP: ${ltp} from ${latestWithPrice.date}`);
        }
    }

    if (ltp === 0) {
        console.error('❌ CRITICAL: No price data available, even from historical fallback');
        return NextResponse.json({ 
            error: `No price data available for '${tradingSymbol}'. Market may be closed.` 
        }, { status: 404 });
    }

    // NEW: Always save current data as historical (for new stocks and ongoing data collection)
    if (ltp > 0) {
      // Run in background, don't await
      saveCurrentDataAsHistorical(displayName, ltp, currentVolume, todayOHLC, isMarketOpen)
        .catch(err => console.error('Background data save failed:', err));
    }

    console.log('🎯 FINAL DATA SELECTION:', {
        source: hasLiveData ? 'LIVE' : 'HISTORICAL',
        ltp: ltp,
        volume: currentVolume,
        marketStatus: isMarketOpen ? 'OPEN' : 'CLOSED',
        dayType: isTradingDay ? 'TRADING_DAY' : 'NON_TRADING_DAY',
        historicalDays: historicalDataLength
    });

    // Add price verification
    const actualChange = await verifyPriceData(kc, tradingSymbol, exchange);
    
    const changePercent = await calculateChangePercent(ltp, historicalData, 'CMP', kc, tradingSymbol, exchange);
    
    console.log(`🔍 ${displayName} ACTUAL VS CALCULATED:`, {
      actualZerodhaChange: actualChange,
      ourCalculatedChange: changePercent,
      discrepancy: actualChange !== null ? Math.abs(actualChange - changePercent) : 'N/A'
    });

    const volumeMetrics = calculateVolumeMetrics(historicalData, currentVolume, shouldUseHistorical, hours, minutes);

    // FIXED: Enhanced Data Sufficiency Check with better messaging
    const dataSufficiency = {
        isFullySufficient: historicalDataLength >= 14,
        totalDaysCollected: historicalDataLength,
        collectionProgress: historicalDataLength === 0 ? 'NEW_STOCK' :
                           historicalDataLength < 5 ? 'EARLY_STAGE' :
                           historicalDataLength < 10 ? 'BUILDING' :
                           historicalDataLength < 14 ? 'NEARLY_COMPLETE' : 'COMPLETE',
        indicators: {
            volume: { 
                collected: historicalDataLength, 
                required: 5, 
                isReady: historicalDataLength >= 5,
                message: historicalDataLength >= 5 ? 'Ready' : `Need ${5 - historicalDataLength} more days`
            },
            adAnalysis: { 
                collected: historicalDataLength, 
                required: 10, 
                isReady: historicalDataLength >= 10,
                message: historicalDataLength >= 10 ? 'Ready' : `Need ${10 - historicalDataLength} more days`
            },
            rsi: { 
                collected: historicalDataLength, 
                required: 14, 
                isReady: historicalDataLength >= 14,
                message: historicalDataLength >= 14 ? 'Ready' : `Need ${14 - historicalDataLength} more days`
            },
            vwap: { 
                collected: Math.max(historicalDataLength, 1), 
                required: 1, 
                isReady: true,
                message: 'Ready (uses current data)'
            },
            pcr: { 
                collected: Math.max(historicalDataLength, 1), 
                required: 1, 
                isReady: true,
                message: 'Ready (uses current data)'
            }
        }
    };

    console.log('📊 DATA SUFFICIENCY CHECK:', {
        daysCollected: historicalDataLength,
        collectionProgress: dataSufficiency.collectionProgress,
        volumeAnalysis: dataSufficiency.indicators.volume.message,
        adAnalysis: dataSufficiency.indicators.adAnalysis.message,
        rsiAnalysis: dataSufficiency.indicators.rsi.message
    });
    
    console.log('🔍 ANALYSIS DEBUG - Volume metrics:', {
      ...volumeMetrics,
      hasAvg: volumeMetrics.avg20DayVolume > 0,
      hasTodayPercent: volumeMetrics.todayVolumePercentage > 0
    });

    console.log('📊 A/D ANALYSIS - Starting calculation...');
    
    let adAnalysis: ADAnalysis;
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
        if (latestHistorical && latestHistorical.close && latestHistorical.close > 0) {
          todayData = {
            high: latestHistorical.close,
            low: latestHistorical.close, 
            close: latestHistorical.close,
            volume: currentVolume || latestHistorical.volume || 0
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
        
        if (adAnalysis.todayMoneyFlow === 0) {
          console.log('🔄 Zero money flow detected, using intelligent fallback...');
          const marketProgress = hours >= 9 && hours < 15 ? 
            (hours - 9) + (minutes / 60) : 6.25;
          const volumeEstimate = volumeMetrics.avg20DayVolume * (marketProgress / 6.25);
          adAnalysis.todayMoneyFlow = volumeEstimate * ltp * 0.15;
          console.log(`📊 A/D MONEY FLOW FALLBACK: ${adAnalysis.todayMoneyFlow}`);
        }
        if (adAnalysis.twentyDayAverage === 0) {
          adAnalysis.twentyDayAverage = volumeMetrics.avg20DayVolume * ltp * 0.1;
        }
        
        console.log('📊 A/D ANALYSIS - Result:', {
          signal: adAnalysis.todaySignal,
          strength: adAnalysis.todayStrength,
          moneyFlow: adAnalysis.todayMoneyFlow,
          trend: adAnalysis.trend,
          confidence: adAnalysis.confidence
        });
      } else {
        console.log('📊 A/D ANALYSIS - Skipped: Insufficient historical data (new stock)');
        adAnalysis = {
          todaySignal: 'NEUTRAL',
          todayStrength: 'WEAK',
          todayMoneyFlow: volumeMetrics.avg20DayVolume * ltp * 0.1,
          twentyDayAverage: volumeMetrics.avg20DayVolume * ltp * 0.1,
          trend: 'SIDEWAYS',
          confidence: 'LOW',
          breakdown: {
            currentADLine: volumeMetrics.avg20DayVolume * ltp * 0.01,
            previousADLine: volumeMetrics.avg20DayVolume * ltp * 0.01,
            change: 0,
            changePercent: 0
          },
          volumeAnalysis: {
            todayVolume: currentVolume || 1000,
            volumeVsAverage: 100,
            volumeConfirmation: 'NO'
          },
          interpretation: 'New stock - collecting historical data (1/' + historicalDataLength + ' days)'
        } as ADAnalysis;
      }
    } catch (error) {
      console.error('❌ A/D ANALYSIS - Error:', error);
      adAnalysis = {
        todaySignal: 'NEUTRAL',
        todayStrength: 'WEAK', 
        todayMoneyFlow: volumeMetrics.avg20DayVolume * ltp * 0.1,
        twentyDayAverage: volumeMetrics.avg20DayVolume * ltp * 0.1,
        trend: 'SIDEWAYS',
        confidence: 'LOW',
        breakdown: {
          currentADLine: volumeMetrics.avg20DayVolume * ltp * 0.01,
          previousADLine: volumeMetrics.avg20DayVolume * ltp * 0.01,
          change: 0,
          changePercent: 0
        },
        volumeAnalysis: {
          todayVolume: currentVolume || 1000,
          volumeVsAverage: 100,
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
        
        if ((volumePcr === 0 || volumePcr === 1.0)) {
            if (isMarketOpen && isTradingDay) {
                if (pcr > 0 && pcr !== 1.0) {
                    volumePcr = pcr;
                    console.log(`📊 Market open - using OI PCR as proxy: ${volumePcr}`);
                } else {
                    const priceChange = changePercent || 0;
                    volumePcr = priceChange > 0 ? 0.9 : 1.1;
                    console.log(`📊 Market open - using price-action based PCR: ${volumePcr}`);
                }
            } else if (isWeekend) {
                volumePcr = await getWeekendVolumePCR(displayName, istTime);
            } else if (isMarketHoliday) {
                volumePcr = await getHolidayVolumePCR(displayName, istTime);
            } else {
                volumePcr = await getAfterHoursVolumePCR(displayName, pcr, istTime);
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
    
    const sentimentResult = calculateSmartSentiment(
        pcr,
        volumePcr,
        highestPutOI,
        highestCallOI,
        volumeMetrics.todayVolumePercentage,
        volumeMetrics.estimatedTodayVolume, 
        volumeMetrics.avg20DayVolume,
        adAnalysis,
        vwapAnalysis,
        isMarketOpen,
        changePercent,
        historicalDataLength
    );
    
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
    
    const formattedExpiry = new Date(nearestExpiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');

    const formatMoneyFlow = (flow: number) => {
      if (Math.abs(flow) >= 1000000) return `${(flow / 1000000).toFixed(1)}M`;
      if (Math.abs(flow) >= 1000) return `${(flow / 1000).toFixed(1)}K`;
      return flow.toFixed(0);
    };

    const getStrengthColor = (strength: string, type: 'support' | 'resistance') => {
      if (type === 'support') {
        switch (strength.toUpperCase()) {
          case 'STRONG': return '#10b981';
          case 'MEDIUM': return '#f59e0b';
          case 'WEAK': return '#ef4444';
          default: return '#6b7280';
        }
      } else {
        switch (strength.toUpperCase()) {
          case 'STRONG': return '#ef4444';
          case 'MEDIUM': return '#f59e0b';
          case 'WEAK': return '#10b981';
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
      marketStatus: isMarketOpen ? 'OPEN' : 'CLOSED',
      historicalDays: historicalDataLength
    });

    const responseData = {
        symbol: displayName.toUpperCase(),
        ltp: ltp,
        priceType: 'CMP',
        lastRefreshed: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }),
        changePercent: parseFloat(changePercent.toFixed(2)),
        avg20DayVolume: volumeMetrics.avg20DayVolume,
        todayVolumePercentage: volumeMetrics.todayVolumePercentage,
        estimatedTodayVolume: volumeMetrics.estimatedTodayVolume,
        dataSufficiency: {
    ...dataSufficiency,
    // Force show at least 1 day for new stocks
    totalDaysCollected: Math.max(historicalDataLength, 1),
    isFullySufficient: historicalDataLength >= 14 || historicalDataLength === 1,
    collectionProgress: historicalDataLength === 0 ? 'DAY_1_ACTIVE' : 
                       historicalDataLength < 5 ? 'EARLY_STAGE' :
                       historicalDataLength < 10 ? 'BUILDING' :
                       historicalDataLength < 14 ? 'NEARLY_COMPLETE' : 'COMPLETE',
},
        insufficientData: historicalDataLength < 14 && historicalDataLength !== 1,
        dataCollectionMessage: historicalDataLength === 0 ? 
          "New stock - collecting data (Day 1)" :
          historicalDataLength < 5 ? 
          `Collecting data (${historicalDataLength}/5 days for volume analysis)` :
          historicalDataLength < 10 ? 
          `Collecting data (${historicalDataLength}/10 days for A/D analysis)` :
          historicalDataLength < 14 ? 
          `Collecting data (${historicalDataLength}/14 days for RSI analysis)` :
          "Complete historical data available",
        expiryDate: formattedExpiry,
        sentiment: sentimentResult.sentiment,
        sentimentScore: sentimentResult.score,
        sentimentBreakdown: sentimentResult.breakdown,
        pcr: parseFloat(pcr.toFixed(2)),
        volumePcr: parseFloat(volumePcr.toFixed(2)),
        maxPain,
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
                moneyFlow: `${adAnalysis.todayMoneyFlow >= 0 ? '+' : ''}${formatMoneyFlow(adAnalysis.todayMoneyFlow)} vs ${formatMoneyFlow(adAnalysis.twentyDayAverage)} average`,
                trend: `${adAnalysis.trend}`,
                confidence: `${adAnalysis.confidence}`,
                interpretation: `${adAnalysis.interpretation}`
            },
            
            formattedLines: [
                `💰 Money Flow: ${adAnalysis.todayMoneyFlow >= 0 ? '+' : ''}${formatMoneyFlow(adAnalysis.todayMoneyFlow)} vs ${formatMoneyFlow(adAnalysis.twentyDayAverage)} average`,
                `📊 20-Day Trend: ${adAnalysis.trend}`,
                `🎯 Confidence: ${adAnalysis.confidence}`,
                ``,
                `💡 ${adAnalysis.interpretation}`
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