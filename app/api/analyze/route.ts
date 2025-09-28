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
    
    // Simple hardcoded major holidays for 2025
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

// FIXED: Change percent calculation - never 0%
function calculateChangePercent(currentPrice: number, historicalData: HistoricalData[], priceType: string): number {
  console.log(`📈 Calculating change percent for price: ${currentPrice}, historical entries: ${historicalData.length}`);
  
  if (!historicalData || historicalData.length === 0 || !currentPrice) {
    console.log('⚠️ Insufficient data for change calculation');
    return 0.01;
  }
  
  const sortedHistorical = historicalData.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  
  for (const dayData of sortedHistorical) {
    if (dayData.lastPrice && dayData.lastPrice !== currentPrice && dayData.lastPrice > 0) {
      const changePercent = ((currentPrice - dayData.lastPrice) / dayData.lastPrice) * 100;
      console.log(`📊 Change calculation: Today(${currentPrice}) vs ${dayData.date} (${dayData.lastPrice}) = ${changePercent.toFixed(2)}%`);
      
      if (Math.abs(changePercent) < 0.01) {
        console.log('📊 Change is near zero, using minimal non-zero value');
        return currentPrice > dayData.lastPrice ? 0.01 : -0.01;
      }
      return changePercent;
    }
  }
  
  console.log('📊 All historical prices are same, using minimal change');
  return 0.01;
}

function calculateVolumeMetrics(historicalData: HistoricalData[], currentVolume?: number, isUsingHistoricalFallback: boolean = false): {
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
    // MARKET HOURS: Use live volume with projection
    const marketProgress = new Date().getHours() >= 9 && new Date().getHours() < 15 ? 
      (new Date().getHours() - 9) + (new Date().getMinutes() / 60) : 6.25;
    const expectedDailyVolume = Math.max(averageVolume, 1000) * (marketProgress / 6.25);
    result.todayVolumePercentage = Math.max(parseFloat((currentVolume / expectedDailyVolume * 100).toFixed(1)), 1);
    result.estimatedTodayVolume = Math.max(Math.round(currentVolume * (6.25 / marketProgress)), 1000);
    
    console.log('📊 Using LIVE volume data:', {
      currentVolume,
      marketProgress,
      todayVolumePercentage: result.todayVolumePercentage,
      estimatedTodayVolume: result.estimatedTodayVolume
    });
  } else if (historicalData.length > 0) {
    // NON-MARKET HOURS or HISTORICAL FALLBACK: Use latest historical volume as "Last Volume"
    const sortedHistorical = historicalData.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const latestHistorical = sortedHistorical[0];
    
    if (latestHistorical && latestHistorical.totalVolume > 0) {
      const lastVolume = latestHistorical.totalVolume;
      
      // FIX: Use the actual historical volume directly, don't apply market progress logic
      result.todayVolumePercentage = Math.max(parseFloat((lastVolume / averageVolume * 100).toFixed(1)), 1);
      result.estimatedTodayVolume = lastVolume; // This becomes "Last Volume" in frontend
      
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

function findResistanceLevels(currentPrice: number, optionsByStrike: Record<number, { ce_oi: number, pe_oi: number }>, allStrikes: number[]): SupportResistanceLevel[] {
  console.log('🔍 RESISTANCE LEVELS: Starting calculation');
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
  if (candidates.length === 0) {
    console.log('🔍 RESISTANCE LEVELS: No candidates found');
    return [];
  }
  candidates.sort((a, b) => (optionsByStrike[b.price]?.ce_oi || 0) - (optionsByStrike[a.price]?.ce_oi || 0));
  const significantLevels = candidates.slice(0, 5);
  console.log(`🔍 RESISTANCE LEVELS: Found ${significantLevels.length} significant levels`);
  return significantLevels.sort((a, b) => a.price - b.price);
}

function findSupportLevels(currentPrice: number, optionsByStrike: Record<number, { ce_oi: number, pe_oi: number }>, allStrikes: number[]): SupportResistanceLevel[] {
  console.log('🔍 OI SUPPORT CALCULATION DETAILS:');
  console.log('CMP:', currentPrice);
  
  const candidates: SupportResistanceLevel[] = [];
  for (const strike of allStrikes) {
    if (strike < currentPrice) {
      const { ce_oi, pe_oi } = optionsByStrike[strike] || { ce_oi: 0, pe_oi: 0 };
      const oiRatio = pe_oi / ce_oi;
      
      if (pe_oi < 30000 || ce_oi < 1000) {
        continue;
      }
      
      if (oiRatio >= 1.3) {
        console.log(`  ✅ OI SUPPORT CANDIDATE - Strike ${strike}, Ratio ${oiRatio.toFixed(2)}`);
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
  
  console.log('🔍 OI Supports found:', candidates.map(c => `${c.price} (${c.strength})`));
  if (candidates.length === 0) return [];
  candidates.sort((a, b) => (optionsByStrike[b.price]?.pe_oi || 0) - (optionsByStrike[a.price]?.pe_oi || 0));
  const significantLevels = candidates.slice(0, 5);
  return significantLevels.sort((a, b) => b.price - a.price);
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

function getFinalLevels(
  symbol: string, 
  history: HistoricalData[], 
  currentPrice: number, 
  optionsByStrike: Record<number, { ce_oi: number, pe_oi: number }>, 
  allStrikes: number[]
): { supports: SupportResistanceLevel[], resistances: SupportResistanceLevel[] } {
  
  console.log('🔍 FINAL LEVELS DEBUG =================');
  console.log('Symbol:', symbol);
  console.log('Current Price:', currentPrice);
  
  const allSupports: SupportResistanceLevel[] = [];
  const allResistances: SupportResistanceLevel[] = [];
  
  const addLevel = (levelToAdd: SupportResistanceLevel, list: SupportResistanceLevel[]) => {
    if (!list.some(existingLevel => existingLevel.price === levelToAdd.price)) {
      list.push(levelToAdd);
    }
  };

  console.log('📊 OI-BASED SUPPORT ANALYSIS:');
  const oiSupports = findSupportLevels(currentPrice, optionsByStrike, allStrikes);
  console.log('OI Supports found:', oiSupports.map(s => `${s.price} (${s.strength})`));
  oiSupports.forEach(l => addLevel(l, allSupports));
  
  console.log('📊 HISTORICAL SUPPORT ANALYSIS:');
  const historicalLevels = calculateSupportResistance(history, currentPrice);
  const historicalSupports = historicalLevels.filter(l => l.type === 'support');
  console.log('Historical Supports found:', historicalSupports.map(s => `${s.price} (${s.strength})`));
  historicalSupports.forEach(l => addLevel(l, allSupports));
  
  console.log('📊 PSYCHOLOGICAL LEVELS:');
  const psychLevels = getPsychologicalLevels(symbol, currentPrice);
  const psychSupports = psychLevels.filter(price => price < currentPrice)
    .map(price => ({ 
      price, 
      strength: 'medium' as const, 
      type: 'support' as const, 
      tooltip: 'Psychological Level' 
    }));
  console.log('Psychological Supports found:', psychSupports.map(s => `${s.price} (${s.strength})`));
  psychSupports.forEach(l => addLevel(l, allSupports));
  
  console.log('📊 ALL SUPPORTS BEFORE DEDUPE:');
  allSupports.forEach((support, index) => {
    console.log(`  ${index + 1}. ${support.price} - ${support.strength} - ${support.tooltip}`);
  });
  
  const uniqueSupports = allSupports.filter((support, index, array) => 
    index === array.findIndex(s => s.price === support.price)
  );
  
  const finalSupports = uniqueSupports
    .sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice))
    .slice(0, 2);
  
  console.log('🎯 FINAL SUPPORTS:', finalSupports.map(s => `${s.price} (${s.strength})`));
  console.log('====================================');
  
  findResistanceLevels(currentPrice, optionsByStrike, allStrikes).forEach(l => addLevel(l, allResistances));
  const historicalResistances = historicalLevels.filter(l => l.type === 'resistance');
  historicalResistances.forEach(l => addLevel(l, allResistances));
  const psychResistances = psychLevels.filter(price => price > currentPrice)
    .map(price => ({ price, strength: 'medium' as const, type: 'resistance' as const, tooltip: 'Psychological Level' }));
  psychResistances.forEach(l => addLevel(l, allResistances));

  const finalResistances = allResistances
    .filter((resistance, index, array) => index === array.findIndex(r => r.price === resistance.price))
    .sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice))
    .slice(0, 2);

  return {
    supports: finalSupports,
    resistances: finalResistances
  };
}

// UPDATED: Smart sentiment with scoring breakdown for tooltip
function calculateSmartSentiment(
  pcr: number,
  volumePcr: number,
  highestPutOI: number,
  highestCallOI: number,
  todayVolumePercentage: number
): { sentiment: string; score: number; breakdown: string[] } {
  console.log('🧠 SENTIMENT CALCULATION:', { pcr, volumePcr, highestPutOI, highestCallOI, todayVolumePercentage });
  
  const breakdown: string[] = [];
  
  // 1. PCR Score
  let pcrScore = 0;
  if (pcr > 1.3) pcrScore = 2;
  else if (pcr > 1.1) pcrScore = 1;
  else if (pcr >= 0.9) pcrScore = 0;
  else if (pcr < 0.7) pcrScore = -2;
  else if (pcr < 0.9) pcrScore = -1;

  breakdown.push(`${pcrScore >= 0 ? '+' : ''}${pcrScore} • OI PCR ${pcr.toFixed(2)}`);

  // 2. Conviction Score
  let convictionScore = 0;
  if (highestPutOI > highestCallOI * 2) convictionScore = 2;
  else if (highestPutOI > highestCallOI * 1.2) convictionScore = 1;
  else if (highestCallOI > highestPutOI * 2) convictionScore = -2;
  else if (highestCallOI > highestPutOI * 1.2) convictionScore = -1;

  breakdown.push(`${convictionScore >= 0 ? '+' : ''}${convictionScore} • OI Strength`);

  // 3. Volume Modifier
  let volumeModifier = 0;
  if (volumePcr < 0.7) volumeModifier = 2;
  else if (volumePcr < 0.9) volumeModifier = 1;
  else if (volumePcr <= 1.1) volumeModifier = 0;
  else if (volumePcr > 1.3) volumeModifier = -2;
  else if (volumePcr > 1.1) volumeModifier = -1;

  breakdown.push(`${volumeModifier >= 0 ? '+' : ''}${volumeModifier} • Volume PCR ${volumePcr.toFixed(2)}`);

  // Calculate preliminary score
  const preliminaryScore = pcrScore + convictionScore + volumeModifier;

  // 4. Volume Activity Adjustment
  let volumeAdjustment = 0;
  const isSignificantVolume = todayVolumePercentage > 150;
  const isLowVolume = todayVolumePercentage < 70;

  if (isSignificantVolume) {
    if (preliminaryScore > 0) volumeAdjustment = 1;
    else if (preliminaryScore < 0) volumeAdjustment = -1;
  } else if (isLowVolume && Math.abs(preliminaryScore) >= 2) {
    if (preliminaryScore > 0) volumeAdjustment = -1;
    else if (preliminaryScore < 0) volumeAdjustment = 1;
  }

if (volumeAdjustment !== 0) {
  const direction = volumeAdjustment > 0 ? "bullish" : "bearish";
  const context = isSignificantVolume ? 
    `(high volume amplifying ${direction} sentiment)` : 
    `(low volume reducing ${direction} conviction)`;
  
  breakdown.push(`${volumeAdjustment >= 0 ? '+' : ''}${volumeAdjustment} • Volume Impact ${context}`);
}

  const finalScore = preliminaryScore + volumeAdjustment;

  // Add separator and total
  
  breakdown.push(`Total: ${finalScore >= 0 ? '+' : ''}${finalScore}`);

  // Determine sentiment
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
    
    // Enhanced market calendar detection
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

    // Google Sheets authentication
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
    
    // ENHANCED: Price and data fetching with proper non-market hours handling
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

    // Smart fallback to historical data during non-market hours
    const historicalData = await getHistoricalData(displayName);
    console.log('🔍 VOLUME DATA SOURCE DEBUG:', {
  symbol: displayName,
  historicalEntries: historicalData.length,
  latestHistorical: historicalData.length > 0 ? historicalData[0] : null,
  currentVolume: currentVolume,
  isMarketOpen: isMarketOpen
});
    const hasLiveData = ltp > 0 && currentVolume > 0;
    const shouldUseHistorical = !hasLiveData || !isMarketOpen || !isTradingDay;

    console.log('🔄 DATA SOURCE ANALYSIS:', {
        hasLiveData,
        isMarketOpen,
        isTradingDay,
        shouldUseHistorical,
        historicalDataLength: historicalData.length
    });

    if (shouldUseHistorical && historicalData.length > 0) {
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

    // Final fallback if still no data
    if (ltp === 0 && historicalData.length > 0) {
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

    console.log('🔍 ANALYSIS DEBUG - Historical data for', displayName, ':', {
      length: historicalData.length,
      sample: historicalData.slice(0, 3),
      hasData: historicalData.length > 0,
      hasVolume: historicalData.filter(entry => entry.totalVolume > 0).length
    });
    
    // FIXED: Change percent calculation
    const changePercent = calculateChangePercent(ltp, historicalData, 'CMP');
    const volumeMetrics = calculateVolumeMetrics(historicalData, currentVolume, shouldUseHistorical);
    
    console.log('🔍 ANALYSIS DEBUG - Volume metrics:', {
      ...volumeMetrics,
      hasAvg: volumeMetrics.avg20DayVolume > 0,
      hasTodayPercent: volumeMetrics.todayVolumePercentage > 0
    });

    // --- A/D ANALYSIS INTEGRATION ---
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
      } else if (historicalData.length > 0) {
        const latestHistorical = historicalData[historicalData.length - 1];
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
        historicalDataLength: historicalData.length,
        hasValidOHLC: todayOHLC ? (todayOHLC.high > 0 && todayOHLC.low > 0) : false
      });

      if (historicalData.length >= 1) {
        adAnalysis = generateADAnalysis(displayName.toUpperCase(), historicalData, todayData);
        
        // Ensure money flow is never 0
        if (adAnalysis.todayMoneyFlow === 0) {
          console.log('🔄 Zero money flow detected, using intelligent fallback...');
          const marketProgress = new Date().getHours() >= 9 && new Date().getHours() < 15 ? 
            (new Date().getHours() - 9) + (new Date().getMinutes() / 60) : 6.25;
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
        console.log('📊 A/D ANALYSIS - Skipped: Insufficient historical data');
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
          interpretation: 'Insufficient historical data for A/D analysis'
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

    // --- RSI ANALYSIS INTEGRATION ---
    console.log('📊 RSI ANALYSIS - Starting calculation...');
    const rsiAnalysis = calculateRSI(historicalData, 14);
    console.log('📊 RSI ANALYSIS - Result:', rsiAnalysis);

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

    // ENHANCED: Volume PCR with comprehensive fallback strategies
    if (volumePcr === 0 || volumePcr === 1.0) {
        console.log('🔄 Volume PCR is 0/1, applying comprehensive fallback strategies...');
        
        // Strategy 1: Check stored data first
        const dailyDataStr = await getRedisData('daily_sentiment_data');
        if (dailyDataStr) {
            const dailyData: Record<string, any> = JSON.parse(dailyDataStr);
            const symbolData = dailyData[displayName.toUpperCase()];
            if (symbolData && symbolData.volumePcr && symbolData.volumePcr !== 0 && symbolData.volumePcr !== 1.0) {
                volumePcr = symbolData.volumePcr;
                console.log(`📊 Using stored volume PCR: ${volumePcr}`);
            }
        }
        
        // Strategy 2: Different approaches based on market conditions
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

    // Final sanity check with context-aware ranges
    const reasonableMin = isMarketOpen ? 0.3 : 0.1;
    const reasonableMax = isMarketOpen ? 3.0 : 5.0;
    if (volumePcr <= reasonableMin || volumePcr >= reasonableMax) {
        console.log('🔄 Volume PCR out of reasonable range, normalizing...');
        volumePcr = Math.min(Math.max(volumePcr, reasonableMin), reasonableMax);
        console.log(`📊 Normalized volume PCR: ${volumePcr}`);
    }

    // Ensure PCR is never 0
    if (pcr === 0) {
        pcr = totalPutOI > 0 ? 999 : 1.0;
        console.log(`📊 Zero PCR handled: ${pcr}`);
    }

    console.log('📊 FINAL PCR VALUES:', { 
        pcr: parseFloat(pcr.toFixed(3)), 
        volumePcr: parseFloat(volumePcr.toFixed(3)),
        marketCondition: isMarketOpen ? 'MARKET_OPEN' : isWeekend ? 'WEEKEND' : isMarketHoliday ? 'HOLIDAY' : 'AFTER_HOURS'
    });

    const { supports: supportLevels, resistances: resistanceLevels } = getFinalLevels(
      displayName.toUpperCase(), 
      historicalData, 
      ltp, 
      optionsByStrike, 
      strikePrices
    );

    const finalSupport = supportLevels.length > 0 ? supportLevels[0].price : 0;
    const finalResistance = resistanceLevels.length > 0 ? resistanceLevels[0].price : 0;
    
    // UPDATED: Sentiment calculation with breakdown
    const sentimentResult = calculateSmartSentiment(
        pcr,
        volumePcr,
        highestPutOI,
        highestCallOI,
        volumeMetrics.todayVolumePercentage
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

    const getStrengthColor = (strength: string) => {
      switch (strength.toUpperCase()) {
        case 'VERY_STRONG': return '#10b981';
        case 'STRONG': return '#3b82f6';
        case 'MODERATE': return '#f59e0b';
        case 'WEAK': return '#6b7280';
        default: return '#6b7280';
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
        avg20DayVolume: volumeMetrics.avg20DayVolume,
        todayVolumePercentage: volumeMetrics.todayVolumePercentage,
        estimatedTodayVolume: volumeMetrics.estimatedTodayVolume,
        expiryDate: formattedExpiry,
        sentiment: sentimentResult.sentiment,
        sentimentScore: sentimentResult.score,
        sentimentBreakdown: sentimentResult.breakdown,
        pcr: parseFloat(pcr.toFixed(2)),
        volumePcr: parseFloat(volumePcr.toFixed(2)),
        maxPain,
        support: finalSupport, 
        resistance: finalResistance,
        supports: supportLevels,
        resistances: resistanceLevels,
        marketStatus: isMarketOpen ? 'OPEN' : 'CLOSED',
        dataSource: hasLiveData ? 'LIVE' : 'HISTORICAL',
        
        adAnalysis: {
            todaySignal: adAnalysis.todaySignal,
            todayStrength: adAnalysis.todayStrength,
            trend: adAnalysis.trend,
            confidence: adAnalysis.confidence,
            
            styling: {
                signalColor: getSignalColor(adAnalysis.todaySignal),
                strengthColor: getStrengthColor(adAnalysis.todayStrength),
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
                strengthColor: getStrengthColor(rsiAnalysis.strength),
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