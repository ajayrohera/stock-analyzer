// utils/ad-analysis.ts

// Recreate the interface locally to avoid import issues
interface HistoricalData {
  date: string;
  totalVolume: number;
  lastPrice?: number;
  timestamp: number;
  high?: number;
  low?: number;  
  close?: number;
}

export interface ADAnalysis {
  todaySignal: 'ACCUMULATION' | 'DISTRIBUTION' | 'NEUTRAL';
  todayStrength: 'VERY_STRONG' | 'STRONG' | 'MODERATE' | 'WEAK';
  todayMoneyFlow: number;
  twentyDayAverage: number;
  avgDaysUsed: number; // --- NEW: actual number of days used for the average (may be < 20 if less history exists)
  trend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  trendDaysUsed: number; // --- NEW: actual total days used for the trend comparison (may be < 20 if less history exists)
  breakdown: {
    currentADLine: number;
    previousADLine: number;
    change: number;
    changePercent: number;
  };
  volumeAnalysis: {
    todayVolume: number;
    volumeVsAverage: number;
    volumeConfirmation: 'YES' | 'NO';
  };
  interpretation: string;
}

export function calculateMoneyFlowMultiplier(high: number, low: number, close: number): number {
  if (high === low) return 0; // Avoid division by zero
  return ((close - low) - (high - close)) / (high - low);
}

export function calculateMoneyFlowVolume(multiplier: number, volume: number): number {
  return multiplier * volume;
}

export function calculateADLine(historicalData: HistoricalData[]): number {
  return historicalData.reduce((adLine, day) => {
    // Use lastPrice for high, low, close if OHLC not available
    const high = day.high || day.lastPrice || 0;
    const low = day.low || day.lastPrice || 0;
    const close = day.close || day.lastPrice || 0;
    
    if (high > 0 && low > 0 && close > 0 && day.totalVolume) {
      const multiplier = calculateMoneyFlowMultiplier(high, low, close);
      const moneyFlow = calculateMoneyFlowVolume(multiplier, day.totalVolume);
      return adLine + moneyFlow;
    }
    return adLine;
  }, 0);
}

export function analyzeADTrend(historicalData: HistoricalData[]): {
  trend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  daysUsed: number; // --- NEW: actual total days used (recent window + previous window combined)
} {
  // --- FIX: widened from 5-day-vs-prior-5-day (10 days total) to
  // 10-day-vs-prior-10-day (20 days total) when full history is
  // available. Also now HONESTLY reports how many days were actually
  // used — if fewer than 20 total days exist, the previous window may
  // silently be smaller than 10, and the UI should say so rather than
  // claim "20-Day" regardless of real data availability.
  if (historicalData.length < 10) return { trend: 'SIDEWAYS', confidence: 'LOW', daysUsed: historicalData.length };
  
  const recentWindow = historicalData.slice(-10);
  const previousWindow = historicalData.slice(-20, -10);
  const daysUsed = recentWindow.length + previousWindow.length;

  const recentAD = calculateADLine(recentWindow);
  const previousAD = calculateADLine(previousWindow);
  
  // Avoid division by zero
  if (Math.abs(previousAD) < 0.001) return { trend: 'SIDEWAYS', confidence: 'LOW', daysUsed };
  
  const change = recentAD - previousAD;
  const changePercent = (change / Math.abs(previousAD)) * 100;
  
  if (Math.abs(changePercent) > 10) {
    return { trend: change > 0 ? 'BULLISH' : 'BEARISH', confidence: 'HIGH', daysUsed };
  } else if (Math.abs(changePercent) > 5) {
    return { trend: change > 0 ? 'BULLISH' : 'BEARISH', confidence: 'MEDIUM', daysUsed };
  }
  
  return { trend: 'SIDEWAYS', confidence: 'LOW', daysUsed };
}

export function generateADAnalysis(
  symbol: string,
  historicalData: HistoricalData[],
  todayData?: { high: number; low: number; close: number; volume: number }
): ADAnalysis {
  // Use available data (minimum 5 days, maximum 20 days)
  const availableData = historicalData.slice(-20);
  
  if (availableData.length === 0) {
    return getNeutralAnalysis("Insufficient historical data");
  }
  
  const twentyDayAD = calculateADLine(availableData);
  const twentyDayAverage = twentyDayAD / availableData.length;
  
  let todayMoneyFlow = 0;
  let todaySignal: 'ACCUMULATION' | 'DISTRIBUTION' | 'NEUTRAL' = 'NEUTRAL';
  let todayStrength: 'VERY_STRONG' | 'STRONG' | 'MODERATE' | 'WEAK' = 'WEAK';
  
  if (todayData) {
    const multiplier = calculateMoneyFlowMultiplier(todayData.high, todayData.low, todayData.close);
    todayMoneyFlow = calculateMoneyFlowVolume(multiplier, todayData.volume);
    
    // IMPROVED: Better signal and strength calculation
    if (Math.abs(twentyDayAverage) > 0.001) {
      // Case 1: We have historical average - use ratio-based strength
      const strengthRatio = Math.abs(todayMoneyFlow) / Math.abs(twentyDayAverage);
      
      if (todayMoneyFlow > 0) {
        todaySignal = 'ACCUMULATION';
        if (strengthRatio > 2) todayStrength = 'VERY_STRONG';
        else if (strengthRatio > 1) todayStrength = 'STRONG';
        else if (strengthRatio > 0.5) todayStrength = 'MODERATE';
        else todayStrength = 'WEAK';
      } else if (todayMoneyFlow < 0) {
        todaySignal = 'DISTRIBUTION';
        if (strengthRatio > 2) todayStrength = 'VERY_STRONG';
        else if (strengthRatio > 1) todayStrength = 'STRONG';
        else if (strengthRatio > 0.5) todayStrength = 'MODERATE';
        else todayStrength = 'WEAK';
      } else {
        todaySignal = 'NEUTRAL';
        todayStrength = 'WEAK';
      }
    } else if (Math.abs(todayMoneyFlow) > 0) {
      // Case 2: No historical average, but we have today's money flow
      // Use absolute value to determine strength
      const absoluteMoneyFlow = Math.abs(todayMoneyFlow);
      
      if (todayMoneyFlow > 0) {
        todaySignal = 'ACCUMULATION';
      } else {
        todaySignal = 'DISTRIBUTION';
      }
      
      // Determine strength based on absolute money flow magnitude
      if (absoluteMoneyFlow > 1000000) todayStrength = 'STRONG'; // Over 1M
      else if (absoluteMoneyFlow > 100000) todayStrength = 'MODERATE'; // Over 100K
      else todayStrength = 'WEAK'; // Less than 100K
    } else {
      // Case 3: No money flow today
      todaySignal = 'NEUTRAL';
      todayStrength = 'WEAK';
    }
  }
  
  const trendAnalysis = analyzeADTrend(historicalData);
  
  // Current A/D line (including today if available)
  const currentADData = todayData ? [...availableData, {
    date: new Date().toISOString().split('T')[0],
    high: todayData.high,
    low: todayData.low,
    close: todayData.close,
    totalVolume: todayData.volume,
    timestamp: Date.now()
  }] : availableData;
  
  const currentADLine = calculateADLine(currentADData);
  const previousADLine = calculateADLine(availableData);
  
  // Calculate change percentage safely
  let changePercent = 0;
  if (Math.abs(previousADLine) > 0.001) {
    changePercent = ((currentADLine - previousADLine) / Math.abs(previousADLine)) * 100;
  }
  
  const avgVolumePerDay = availableData.reduce((sum, day) => sum + day.totalVolume, 0) / availableData.length;
  
  return {
    todaySignal,
    todayStrength,
    todayMoneyFlow,
    twentyDayAverage,
    avgDaysUsed: availableData.length, // --- NEW: real count, not assumed 20
    trend: trendAnalysis.trend,
    confidence: trendAnalysis.confidence,
    trendDaysUsed: trendAnalysis.daysUsed, // --- NEW: real count, not assumed 20
    breakdown: {
      currentADLine,
      previousADLine,
      change: currentADLine - previousADLine,
      changePercent
    },
    volumeAnalysis: {
      todayVolume: todayData?.volume || 0,
      volumeVsAverage: todayData && avgVolumePerDay > 0 ? todayData.volume / avgVolumePerDay : 0,
      volumeConfirmation: todayData && todayData.volume > avgVolumePerDay ? 'YES' : 'NO'
    },
    interpretation: generateInterpretation(todaySignal, todayStrength, trendAnalysis.trend)
  };
}

function getNeutralAnalysis(reason: string): ADAnalysis {
  return {
    todaySignal: 'NEUTRAL',
    todayStrength: 'WEAK',
    todayMoneyFlow: 0,
    twentyDayAverage: 0,
    avgDaysUsed: 0,
    trend: 'SIDEWAYS',
    confidence: 'LOW',
    trendDaysUsed: 0,
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
    interpretation: reason
  };
}

function generateInterpretation(
  signal: string, 
  strength: string, 
  trend: string
): string {
  if (signal === 'ACCUMULATION') {
    if (strength === 'VERY_STRONG') return 'Very strong institutional buying detected with high conviction';
    if (strength === 'STRONG') return 'Strong accumulation pattern suggesting smart money entry';
    if (strength === 'MODERATE') return 'Moderate buying interest, watch for trend confirmation';
    return 'Weak accumulation signal detected';
  }
  
  if (signal === 'DISTRIBUTION') {
    if (strength === 'VERY_STRONG') return 'Heavy distribution indicating strong selling pressure';
    if (strength === 'STRONG') return 'Significant selling activity, consider caution';
    if (strength === 'MODERATE') return 'Moderate selling pressure detected';
    return 'Weak distribution signal detected';
  }
  
  return 'Neutral money flow, waiting for clearer direction';
}
