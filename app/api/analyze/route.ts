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

async function getRedisData(key: string) {
  const client = createClient({ url: process.env.REDIS_URL });
  try {
    await client.connect();
    return await client.get(key);
  } finally {
    await client.quit();
  }
}

// --- HELPER FUNCTIONS ---

// ADDED: Market day detection
function isTradingDay(date: Date): boolean {
    const day = date.getDay();
    // Market closed on Saturdays (6) and Sundays (0)
    return day !== 0 && day !== 6;
}

function getLastTradingDate(): string {
    const now = new Date();
    let checkDate = new Date(now);
    
    // Go backwards until we find a trading day (max 7 days back)
    for (let i = 0; i < 7; i++) {
        if (isTradingDay(checkDate)) {
            return checkDate.toISOString().split('T')[0];
        }
        checkDate.setDate(checkDate.getDate() - 1);
    }
    
    // Fallback to 7 days ago if no trading day found
    const fallbackDate = new Date(now);
    fallbackDate.setDate(fallbackDate.getDate() - 7);
    return fallbackDate.toISOString().split('T')[0];
}

// UPDATED: RSI Calculation Function - Use last available data on weekends
function calculateRSI(historicalData: HistoricalData[], period: number = 14, lastTradingDate?: string): { value: number | null; signal: string; strength: string; interpretation: string } {
  console.log(`📊 RSI Calculation starting with ${historicalData.length} days of data, period: ${period}`);
  
  // Try to use last trading day's RSI if available
  if (lastTradingDate && historicalData.length > 0) {
    const lastTradingRSI = historicalData.find(entry => entry.date === lastTradingDate);
    if (lastTradingRSI && lastTradingRSI.lastPrice) {
      console.log(`📊 Using last trading day (${lastTradingDate}) data for RSI calculation`);
      // Use a simplified RSI calculation based on recent price movement
      const recentData = historicalData.filter(entry => {
        const entryDate = new Date(entry.date);
        const lastDate = new Date(lastTradingDate);
        const diffTime = Math.abs(lastDate.getTime() - entryDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays <= period && entry.lastPrice;
      }).slice(-period);
      
      if (recentData.length >= 2) {
        let gains = 0;
        let losses = 0;
        let gainCount = 0;
        let lossCount = 0;
        
        for (let i = 1; i < recentData.length; i++) {
          const change = (recentData[i].lastPrice! - recentData[i-1].lastPrice!) / recentData[i-1].lastPrice! * 100;
          if (change > 0) {
            gains += change;
            gainCount++;
          } else if (change < 0) {
            losses += Math.abs(change);
            lossCount++;
          }
        }
        
        const avgGain = gainCount > 0 ? gains / gainCount : 0;
        const avgLoss = lossCount > 0 ? losses / lossCount : 0;
        
        if (avgLoss > 0) {
          const rs = avgGain / avgLoss;
          const rsiValue = 100 - (100 / (1 + rs));
          const roundedRSI = Math.round(rsiValue * 100) / 100;
          
          let signal = 'NEUTRAL';
          let strength = 'NEUTRAL';
          let interpretation = `Based on last trading data (${lastTradingDate})`;
          
          if (roundedRSI >= 70) signal = 'OVERBOUGHT';
          else if (roundedRSI <= 30) signal = 'OVERSOLD';
          else if (roundedRSI > 50) signal = 'BULLISH';
          else signal = 'BEARISH';
          
          console.log(`📊 RSI from last trading data: ${roundedRSI}`);
          return {
            value: roundedRSI,
            signal,
            strength,
            interpretation
          };
        }
      }
    }
  }
  
  if (historicalData.length < period + 1) {
    console.log(`❌ Insufficient data for RSI. Need ${period + 1} days, have ${historicalData.length}`);
    return {
      value: null,
      signal: 'INSUFFICIENT_DATA',
      strength: 'LOW',
      interpretation: `Need at least ${period + 1} days of data for RSI calculation`
    };
  }

  try {
    // Sort by date ascending for proper calculation
    const sortedData = [...historicalData].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    let gains: number[] = [];
    let losses: number[] = [];

    // Calculate price changes
    for (let i = 1; i < sortedData.length; i++) {
      const currentPrice = sortedData[i].lastPrice || 0;
      const previousPrice = sortedData[i - 1].lastPrice || 0;
      
      if (currentPrice > 0 && previousPrice > 0) {
        const change = currentPrice - previousPrice;
        gains.push(change > 0 ? change : 0);
        losses.push(change < 0 ? Math.abs(change) : 0);
      }
    }

    // Calculate initial averages
    let avgGain = gains.slice(0, period).reduce((sum, gain) => sum + gain, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((sum, loss) => sum + loss, 0) / period;

    // Wilder's smoothing method for remaining periods
    for (let i = period; i < gains.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }

    // Avoid division by zero
    if (avgLoss === 0) {
      const rsiValue = avgGain > 0 ? 100 : 50;
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

    // Determine signal and strength
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
      value: null,
      signal: 'ERROR',
      strength: 'LOW',
      interpretation: 'Error calculating RSI'
    };
  }
}

async function getHistoricalData(symbol: string): Promise<HistoricalData[]> {
  try {
    const historyData = await getRedisData('volume_history');
    if (!historyData) {
      console.log('❌ No volume_history data found in Redis');
      return [];
    }
    
    const history = JSON.parse(historyData);
    const symbolData = history[symbol.toUpperCase()] || [];
    
    console.log(`📊 Historical data for ${symbol}:`, {
      found: symbolData.length > 0,
      entries: symbolData.length,
      latest: symbolData.length > 0 ? symbolData[symbolData.length - 1] : null
    });
    
    return symbolData;
  } catch (error) { 
    console.error('Error in getHistoricalData:', error); 
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

// UPDATED: Change percent calculation - Use last trading data on weekends
function calculateChangePercent(currentPrice: number, historicalData: HistoricalData[], priceType: string, lastTradingDate?: string): number {
  console.log(`📈 Calculating change percent for price: ${currentPrice}, historical entries: ${historicalData.length}`);
  
  if (!historicalData || historicalData.length === 0 || !currentPrice) {
    console.log('⚠️ Insufficient data for change calculation');
    return 0;
  }
  
  // Use last trading day's data if available
  if (lastTradingDate) {
    const lastTradingData = historicalData.find(entry => entry.date === lastTradingDate);
    if (lastTradingData && lastTradingData.lastPrice && lastTradingData.lastPrice > 0) {
      const changePercent = ((currentPrice - lastTradingData.lastPrice) / lastTradingData.lastPrice) * 100;
      console.log(`📊 Using last trading day (${lastTradingDate}) for change calculation: ${changePercent.toFixed(2)}%`);
      return changePercent;
    }
  }
  
  // Fallback to previous logic
  const now = new Date();
  const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  const todayDateString = istTime.toISOString().split('T')[0];
  
  console.log(`📊 Date debug: Today(IST)=${todayDateString}, Historical dates=`, historicalData.map(d => d.date));
  
  const sortedHistorical = historicalData
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  
  const yesterdayData = sortedHistorical.find(entry => entry.date !== todayDateString);
  
  if (!yesterdayData) {
    console.log('⚠️ No historical data available for comparison');
    return 0;
  }
  
  if (!yesterdayData.lastPrice) {
    console.log('⚠️ Missing yesterday price data');
    return 0;
  }
  
  const changePercent = ((currentPrice - yesterdayData.lastPrice) / yesterdayData.lastPrice) * 100;
  
  console.log(`📊 Change calculation: Today(${currentPrice}) vs ${yesterdayData.date} (${yesterdayData.lastPrice}) = ${changePercent.toFixed(2)}%`);
  
  return changePercent;
}

// UPDATED: Volume metrics - Use last trading data on weekends
function calculateVolumeMetrics(historicalData: HistoricalData[], currentVolume?: number, lastTradingDate?: string): {
  avg20DayVolume: number;
  todayVolumePercentage: number;
  estimatedTodayVolume: number;
} {
  console.log('📊 calculateVolumeMetrics called with:', {
    historicalDataLength: historicalData.length,
    currentVolume: currentVolume,
    lastTradingDate: lastTradingDate
  });
  
  let result = {
    avg20DayVolume: 0,
    todayVolumePercentage: 0,
    estimatedTodayVolume: 0
  };
  
  if (!historicalData.length) {
    console.log('❌ No historical data available');
    return result;
  }
  
  // Use last trading day's volume data on weekends
  if (lastTradingDate && (!currentVolume || currentVolume === 0)) {
    const lastTradingData = historicalData.find(entry => entry.date === lastTradingDate);
    if (lastTradingData) {
      console.log(`📊 Using last trading day (${lastTradingDate}) volume data`);
      result.avg20DayVolume = lastTradingData.totalVolume || 0;
      result.todayVolumePercentage = 100;
      result.estimatedTodayVolume = lastTradingData.totalVolume || 0;
      return result;
    }
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
  
  result.avg20DayVolume = Math.round(averageVolume);
  
  if (currentVolume && currentVolume > 0) {
    const marketProgress = new Date().getHours() >= 9 && new Date().getHours() < 15 ? 
      (new Date().getHours() - 9) + (new Date().getMinutes() / 60) : 6.25;
    const expectedDailyVolume = averageVolume * (marketProgress / 6.25);
    result.todayVolumePercentage = parseFloat((currentVolume / expectedDailyVolume * 100).toFixed(1));
    result.estimatedTodayVolume = Math.round(currentVolume * (6.25 / marketProgress));
  }
  
  return result;
}

// ... (keep all the existing functions: findResistanceLevels, findSupportLevels, calculateSupportResistance, getFinalLevels, calculateSmartSentiment exactly as they are) ...

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
  console.log('🔍 OI SUPPORT CALCULATION DETAILS:');
  console.log('CMP:', currentPrice);
  
  const candidates: SupportResistanceLevel[] = [];
  for (const strike of allStrikes) {
    if (strike < currentPrice) {
      const { ce_oi, pe_oi } = optionsByStrike[strike] || { ce_oi: 0, pe_oi: 0 };
      const oiRatio = pe_oi / ce_oi;
      
      if (strike >= 1380 && strike <= 1400) {
        console.log(`Strike ${strike}: PE=${pe_oi}, CE=${ce_oi}, Ratio=${oiRatio.toFixed(2)}`);
      }
      
      if (pe_oi < 30000 || ce_oi < 1000) {
        if (strike >= 1380 && strike <= 1400) {
          console.log(`  ❌ Skipped - PE<30k or CE<1k`);
        }
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
      } else {
        if (strike >= 1380 && strike <= 1400) {
          console.log(`  ❌ Not OI support - Ratio ${oiRatio.toFixed(2)} < 1.3`);
        }
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
  console.log('1390 Strike Data:', optionsByStrike[1390]);
  
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

function calculateSmartSentiment(
  pcr: number,
  volumePcr: number,
  highestPutOI: number,
  highestCallOI: number,
  todayVolumePercentage: number
): string {
  let pcrScore = 0;
  if (pcr > 1.3) pcrScore = 2;
  else if (pcr > 1.1) pcrScore = 1;
  else if (pcr >= 0.9) pcrScore = 0;
  else if (pcr < 0.7) pcrScore = -2;
  else if (pcr < 0.9) pcrScore = -1;

  let convictionScore = 0;
  if (highestPutOI > highestCallOI * 2) convictionScore = 2;
  else if (highestPutOI > highestCallOI * 1.2) convictionScore = 1;
  else if (highestCallOI > highestPutOI * 2) convictionScore = -2;
  else if (highestCallOI > highestPutOI * 1.2) convictionScore = -1;
  
  let volumeModifier = 0;
  if (volumePcr < 0.7) volumeModifier = 2;
  else if (volumePcr < 0.9) volumeModifier = 1;
  else if (volumePcr <= 1.1) volumeModifier = 0;
  else if (volumePcr > 1.3) volumeModifier = -2;
  else if (volumePcr > 1.1) volumeModifier = -1;

  const preliminaryScore = pcrScore + convictionScore + volumeModifier;
  let finalScore = preliminaryScore;

  const isSignificantVolume = todayVolumePercentage > 150;
  const isLowVolume = todayVolumePercentage < 70;

  if (isSignificantVolume) {
    if (preliminaryScore > 0) finalScore++;
    if (preliminaryScore < 0) finalScore--;
  } else if (isLowVolume) {
    if (Math.abs(preliminaryScore) >= 2) {
        if (preliminaryScore > 0) finalScore--;
        if (preliminaryScore < 0) finalScore++;
    }
  }
  
if (finalScore >= 5) return "Strongly Bullish";
if (finalScore >= 3) return "Bullish";
if (finalScore >= 1) return "Slightly Bullish";
if (finalScore === 0) return "Neutral";
if (finalScore <= -1 && finalScore >= -2) return "Slightly Bearish";
if (finalScore < -2 && finalScore >= -4) return "Bearish";
if (finalScore < -4) return "Strongly Bearish";

return "Neutral";
}

// --- MAIN API FUNCTION ---
export async function POST(request: Request) {
  try {
    const apiKey = process.env.KITE_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });

    const body = await request.json() as { symbol: string };
    const { symbol: displayName } = body;
    if (!displayName) return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });

    // 🕒 MARKET DAY DETECTION
    const now = new Date();
    const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    const hours = istTime.getHours();
    const minutes = istTime.getMinutes();
    const timeInMinutes = hours * 60 + minutes;
    const isTradingDayToday = isTradingDay(istTime);
    const lastTradingDate = getLastTradingDate();
    
    const preMarketStart = 9 * 60 + 0;
    const marketOpen = 9 * 60 + 15;
    const marketClose = 15 * 60 + 30;
    const isPreMarketWindow = (timeInMinutes >= preMarketStart && timeInMinutes < marketOpen);
    
    console.log('📅 MARKET DAY DEBUG =================');
    console.log('Current UTC time:', now.toISOString());
    console.log('Current IST time:', istTime.toISOString());
    console.log('IST Day of week:', istTime.getDay(), `(${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][istTime.getDay()]})`);
    console.log('Is Trading Day Today?', isTradingDayToday);
    console.log('Last Trading Date:', lastTradingDate);
    console.log('Is Pre-market window?', isPreMarketWindow);
    console.log('====================================');

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

    const tokenData = await getRedisData('kite_token');
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
    
    let ltp = quoteDataForSymbol[`${exchange}:${tradingSymbol}`]?.last_price || 0;
    let priceType = 'CMP';
    
    const historicalData = await getHistoricalData(displayName);
    
    // Handle zero LTP - use last trading day's price on weekends
    if (ltp === 0 && historicalData.length > 0) {
        if (!isTradingDayToday && lastTradingDate) {
            const lastTradingData = historicalData.find(entry => entry.date === lastTradingDate);
            if (lastTradingData && lastTradingData.lastPrice) {
                ltp = lastTradingData.lastPrice;
                console.log(`📊 Using last trading day (${lastTradingDate}) price: ${ltp}`);
            }
        } else {
            const sortedHistorical = historicalData.sort((a, b) => 
                new Date(b.date).getTime() - new Date(a.date).getTime());
            
            if (sortedHistorical.length > 0 && sortedHistorical[0] && sortedHistorical[0].lastPrice) {
                ltp = sortedHistorical[0].lastPrice;
                console.log('📊 Using historical data as LTP (zero fallback):', ltp);
            }
        }
    }

    if (ltp === 0) return NextResponse.json({ error: `Could not fetch live price for '${tradingSymbol}'.` }, { status: 404 });
    
    const currentVolume = quoteDataForSymbol[`${exchange}:${tradingSymbol}`]?.volume;
    const todayOHLC = quoteDataForSymbol[`${exchange}:${tradingSymbol}`]?.ohlc;

    console.log('🔍 ANALYSIS DEBUG - Historical data for', displayName, ':', {
      length: historicalData.length,
      sample: historicalData.slice(0, 3),
      hasData: historicalData.length > 0,
      hasVolume: historicalData.filter(entry => entry.totalVolume > 0).length
    });
    
    // UPDATED: Pass lastTradingDate to all calculations
    const changePercent = calculateChangePercent(ltp, historicalData, priceType, lastTradingDate);
    const volumeMetrics = calculateVolumeMetrics(historicalData, currentVolume, lastTradingDate);
    
    console.log('🔍 ANALYSIS DEBUG - Volume metrics:', {
      ...volumeMetrics,
      hasAvg: volumeMetrics.avg20DayVolume > 0,
      hasTodayPercent: volumeMetrics.todayVolumePercentage > 0
    });

    // --- A/D ANALYSIS INTEGRATION ---
    console.log('📊 A/D ANALYSIS - Starting calculation...');
    
    let adAnalysis = null;
    try {
      let todayData = undefined;
      
      if (todayOHLC && todayOHLC.high > 0 && todayOHLC.low > 0 && ltp > 0) {
        todayData = {
          high: Math.max(todayOHLC.high, ltp),
          low: Math.min(todayOHLC.low, ltp),
          close: ltp,
          volume: currentVolume || 0
        };
        
        console.log('📊 A/D ANALYSIS - Using live OHLC data:', todayData);
      } else if (historicalData.length > 0 && !isTradingDayToday && lastTradingDate) {
        // Use last trading day's data on weekends
        const lastTradingData = historicalData.find(entry => entry.date === lastTradingDate);
        if (lastTradingData && lastTradingData.lastPrice) {
          todayData = {
            high: lastTradingData.lastPrice,
            low: lastTradingData.lastPrice, 
            close: lastTradingData.lastPrice,
            volume: lastTradingData.totalVolume || 0
          };
          console.log(`📊 A/D ANALYSIS - Using last trading day (${lastTradingDate}) data as proxy:`, todayData);
        }
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
          todayMoneyFlow: 0,
          twentyDayAverage: 0,
          trend: 'SIDEWAYS',
          confidence: 'LOW',
          breakdown: {
            currentADLine: 0,
            previousADLine: 0,
            change: 0,
            changePercent: 0
          },
          volumeAnalysis: {
            todayVolume: 0,
            volumeVsAverage: 0,
            volumeConfirmation: 'NO'
          },
          interpretation: 'Insufficient historical data for A/D analysis'
        };
      }
    } catch (error) {
      console.error('❌ A/D ANALYSIS - Error:', error);
      adAnalysis = {
        todaySignal: 'NEUTRAL',
        todayStrength: 'WEAK', 
        todayMoneyFlow: 0,
        twentyDayAverage: 0,
        trend: 'SIDEWAYS',
        confidence: 'LOW',
        breakdown: {
          currentADLine: 0,
          previousADLine: 0,
          change: 0,
          changePercent: 0
        },
        volumeAnalysis: {
          todayVolume: 0,
          volumeVsAverage: 0,
          volumeConfirmation: 'NO'
        },
        interpretation: 'A/D analysis failed: ' + (error instanceof Error ? error.message : 'Unknown error')
      };
    }

    // --- RSI ANALYSIS INTEGRATION ---
    console.log('📊 RSI ANALYSIS - Starting calculation...');
    const rsiAnalysis = calculateRSI(historicalData, 14, lastTradingDate);
    console.log('📊 RSI ANALYSIS - Result:', rsiAnalysis);

    const instrumentTokens = optionsChain.map((o: Instrument) => `NFO:${o.tradingsymbol}`);
    const quoteData: QuoteData = await kc.getQuote(instrumentTokens);

    const optionsByStrike: Record<number, { ce_oi: number, pe_oi: number }> = {};
    const strikePrices = [...new Set(optionsChain.map(o => o.strike))].sort((a, b) => a - b);
    
    let totalCallOI = 0, totalPutOI = 0, totalCallVolume = 0, totalPutVolume = 0;
    let highestCallOI = 0, highestPutOI = 0;

    // UPDATED: PCR calculation with weekend handling
    let pcr = 0;
    let volumePcr = 0;
    
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

    pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 0; 
    volumePcr = totalCallVolume > 0 ? totalPutVolume / totalCallVolume : 0;

    // ON WEEKENDS: Use stored PCR data from last trading day
    if ((pcr === 0 || volumePcr === 0) && !isTradingDayToday) {
        console.log('🔄 Weekend detected, using stored PCR data...');
        const dailyDataStr = await getRedisData('daily_sentiment_data');
        if (dailyDataStr) {
            const dailyData = JSON.parse(dailyDataStr);
            const symbolData = dailyData[displayName.toUpperCase()];
            if (symbolData) {
                if (pcr === 0) pcr = symbolData.oiPcr || 0;
                if (volumePcr === 0) volumePcr = symbolData.volumePcr || 0;
                console.log(`📊 Using stored PCR data from last trading day: OI=${pcr}, Volume=${volumePcr}`);
            }
        }
    }

    // Fallback calculations if still 0
    if (pcr === 0) pcr = totalPutOI > 0 ? 999 : 1.0;
    if (volumePcr === 0) volumePcr = totalPutVolume > 0 ? 999 : 1.0;

    const { supports: supportLevels, resistances: resistanceLevels } = getFinalLevels(
      displayName.toUpperCase(), 
      historicalData, 
      ltp, 
      optionsByStrike, 
      strikePrices
    );

    const finalSupport = supportLevels.length > 0 ? supportLevels[0].price : 0;
    const finalResistance = resistanceLevels.length > 0 ? resistanceLevels[0].price : 0;
    
    const sentiment = calculateSmartSentiment(
        pcr,
        volumePcr,
        highestPutOI,
        highestCallOI,
        volumeMetrics.todayVolumePercentage
    );
    
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
    
    const formattedExpiry = new Date(nearestExpiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');

    // Format the money flow for better display
    const formatMoneyFlow = (flow: number) => {
      if (Math.abs(flow) >= 1000000) return `${(flow / 1000000).toFixed(1)}M`;
      if (Math.abs(flow) >= 1000) return `${(flow / 1000).toFixed(1)}K`;
      return flow.toFixed(0);
    };

    // Get strength color for frontend styling
    const getStrengthColor = (strength: string) => {
      switch (strength.toUpperCase()) {
        case 'VERY_STRONG': return '#10b981';
        case 'STRONG': return '#3b82f6';
        case 'MODERATE': return '#f59e0b';
        case 'WEAK': return '#6b7280';
        default: return '#6b7280';
      }
    };

    // Get signal color for frontend styling
    const getSignalColor = (signal: string) => {
      switch (signal.toUpperCase()) {
        case 'ACCUMULATION': return '#10b981';
        case 'DISTRIBUTION': return '#ef4444';
        case 'NEUTRAL': return '#6b7280';
        default: return '#6b7280';
      }
    };

    // ADDED: RSI color function
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

    // Final debug before response
    console.log('🔍 ANALYSIS DEBUG - Final check:', {
      symbol: displayName,
      ltp: ltp,
      priceType: priceType,
      changePercent: changePercent,
      volumeMetrics: volumeMetrics,
      hasSupport: supportLevels.length > 0,
      hasResistance: resistanceLevels.length > 0,
      finalSupports: supportLevels,
      finalResistances: resistanceLevels,
      hasADAnalysis: !!adAnalysis,
      hasRSIAnalysis: !!rsiAnalysis.value,
      isTradingDayToday: isTradingDayToday,
      lastTradingDate: lastTradingDate,
      pcr: pcr,
      volumePcr: volumePcr
    });

    console.log('🎨 FINAL A/D ANALYSIS DEBUG:');
    console.log('🎨 todaySignal:', adAnalysis.todaySignal, 'Type:', typeof adAnalysis.todaySignal);
    console.log('🎨 todayStrength:', adAnalysis.todayStrength, 'Type:', typeof adAnalysis.todayStrength);

    console.log('📊 FINAL RSI ANALYSIS DEBUG:');
    console.log('📊 RSI Value:', rsiAnalysis.value);

    const responseData = {
        symbol: displayName.toUpperCase(),
        ltp: ltp,
        priceType: priceType,
        lastRefreshed: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }),
        changePercent: parseFloat(changePercent.toFixed(2)),
        avg20DayVolume: volumeMetrics.avg20DayVolume,
        todayVolumePercentage: volumeMetrics.todayVolumePercentage,
        estimatedTodayVolume: volumeMetrics.estimatedTodayVolume,
        expiryDate: formattedExpiry,
        sentiment,
        pcr: parseFloat(pcr.toFixed(2)),
        volumePcr: parseFloat(volumePcr.toFixed(2)),
        maxPain,
        support: finalSupport, 
        resistance: finalResistance,
        supports: supportLevels,
        resistances: resistanceLevels,
        
        // Enhanced A/D Analysis Structure
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

        // NEW: RSI Analysis Structure
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