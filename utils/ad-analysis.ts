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
  avgDaysUsed: number;
  trend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS'; // "Recent 10-Day Momentum"
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  trendDaysUsed: number;
  // --- NEW: EMA-based "Overall Trend vs. Baseline" (from the n8n flow's
  // methodology) — how far the cumulative A/D line sits above/below its
  // own 20-day EMA, as a percentage. Genuinely different information from
  // "trend" above: that's a 10-vs-10 day momentum comparison; this is
  // "how stretched is the current level from its own smoothed baseline."
  overallTrend: 'ACCUMULATION' | 'DISTRIBUTION' | 'NEUTRAL';
  trendStrengthPct: number;
  trendStrengthLabel: 'Very Strong' | 'Significant' | 'Neutral' | 'Significant Weakness' | 'Very Weak';
  overallTrendDaysUsed: number; // same 20-day threshold as avgDaysUsed/trendDaysUsed now
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
  interpretation: string; // now the NEW 3-input combined synthesis, not the old redundant sentence
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

// --- NEW: running CUMULATIVE A/D series (one value per day), needed as
// input to the EMA calculation below. calculateADLine() above only ever
// returned a single final summed number — this is the day-by-day build-up
// that an EMA actually operates on.
export function calculateADLineSeries(historicalData: HistoricalData[]): number[] {
  let adLine = 0;
  return historicalData.map(day => {
    const high = day.high || day.lastPrice || 0;
    const low = day.low || day.lastPrice || 0;
    const close = day.close || day.lastPrice || 0;
    if (high > 0 && low > 0 && close > 0 && day.totalVolume) {
      const multiplier = calculateMoneyFlowMultiplier(high, low, close);
      adLine += calculateMoneyFlowVolume(multiplier, day.totalVolume);
    }
    return adLine;
  });
}

// --- NEW: 20-period EMA over the cumulative A/D series, same methodology
// as the n8n flow. Seeded with a simple average of the first 20 values;
// smoothing (k = 2/21) applies from the 21st value onward. With EXACTLY
// 20 days of data, no index ever reaches the smoothing step, so the
// "EMA" is honestly just the plain 20-day average on that first
// qualifying day — genuinely correct, not a fabrication, and it
// naturally becomes a true smoothed EMA as more days accumulate beyond
// that. This is why the outer gate below only requires 20 days, not 21.
export function calculateEMASeries(series: number[], period: number = 20): number[] {
  if (series.length < period) return [];
  let ema = series.slice(0, period).reduce((sum, val) => sum + val, 0) / period;
  return series.map((val, idx) => {
    if (idx >= period) {
      const k = 2 / (period + 1);
      ema = (val * k) + (ema * (1 - k));
    }
    return ema;
  });
}

export function analyzeADTrend(historicalData: HistoricalData[]): {
  trend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  daysUsed: number;
} {
  if (historicalData.length < 10) return { trend: 'SIDEWAYS', confidence: 'LOW', daysUsed: historicalData.length };
  
  const recentWindow = historicalData.slice(-10);
  const previousWindow = historicalData.slice(-20, -10);
  const daysUsed = recentWindow.length + previousWindow.length;

  const recentAD = calculateADLine(recentWindow);
  const previousAD = calculateADLine(previousWindow);
  
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

// --- NEW: EMA-based "Overall Trend vs. Baseline" — direction + magnitude
// label, same thresholds as the n8n flow (>50%/25% etc).
function calculateOverallTrendStrength(availableData: HistoricalData[]): {
  direction: 'ACCUMULATION' | 'DISTRIBUTION' | 'NEUTRAL';
  strengthPct: number;
  label: 'Very Strong' | 'Significant' | 'Neutral' | 'Significant Weakness' | 'Very Weak';
  daysUsed: number;
} {
  if (availableData.length < 20) {
    return { direction: 'NEUTRAL', strengthPct: 0, label: 'Neutral', daysUsed: availableData.length };
  }

  const series = calculateADLineSeries(availableData);
  const emaSeries = calculateEMASeries(series, 20);
  const latestValue = series[series.length - 1];
  const latestEMA = emaSeries[emaSeries.length - 1];

  const strengthPct = Math.abs(latestEMA) > 0.001
    ? ((latestValue - latestEMA) / Math.abs(latestEMA)) * 100
    : 0;

  let label: 'Very Strong' | 'Significant' | 'Neutral' | 'Significant Weakness' | 'Very Weak' = 'Neutral';
  if (strengthPct > 50) label = 'Very Strong';
  else if (strengthPct > 25) label = 'Significant';
  else if (strengthPct < -50) label = 'Very Weak';
  else if (strengthPct < -25) label = 'Significant Weakness';

  const direction: 'ACCUMULATION' | 'DISTRIBUTION' | 'NEUTRAL' =
    strengthPct > 0 ? 'ACCUMULATION' : strengthPct < 0 ? 'DISTRIBUTION' : 'NEUTRAL';

  return { direction, strengthPct, label, daysUsed: availableData.length };
}

// --- NEW: the combined 3-input interpretation, replacing the old
// single-input "Weak distribution signal detected" style sentence (which
// was removed earlier for being purely redundant with the badge above
// it). This one genuinely synthesizes NEW information: whether Recent
// Momentum (10-vs-10) and Overall Trend (EMA-based) AGREE or DISAGREE,
// plus how today's actual money flow direction fits into that picture.
// Both trend signals are weighted equally — neither is treated as more
// authoritative than the other.
function generateCombinedInterpretation(
  recentMomentum: 'BULLISH' | 'BEARISH' | 'SIDEWAYS',
  overallDirection: 'ACCUMULATION' | 'DISTRIBUTION' | 'NEUTRAL',
  overallLabel: string,
  todayMoneyFlow: number
): string {
  const todayPositive = todayMoneyFlow > 0;
  const momentumFlat = recentMomentum === 'SIDEWAYS';
  const overallWeak = overallDirection === 'NEUTRAL';

  // Both signals too weak/flat to say anything confident — defer to today
  if (momentumFlat && overallWeak) {
    return todayPositive
      ? "Today's buying stands out against a fairly flat recent trend — the broader trend isn't strongly positioned either way, making today's move the most notable signal right now."
      : "Today's selling stands out against a fairly flat recent trend — the broader trend isn't strongly positioned either way, making today's move the most notable signal right now.";
  }

  // Momentum flat, but overall trend has a real reading — lead with overall
  if (momentumFlat && !overallWeak) {
    const dir = overallDirection === 'ACCUMULATION' ? 'accumulation' : 'distribution';
    return `Recent 10-day momentum is flat, while the broader trend remains net ${dir} (${overallLabel}).`;
  }

  // Overall trend weak, but momentum has a real reading — lead with momentum
  if (!momentumFlat && overallWeak) {
    const mom = recentMomentum === 'BULLISH' ? 'bullish' : 'bearish';
    return `Recent 10-day momentum is ${mom}, though the broader trend isn't strongly positioned either way — near-term momentum is the more meaningful signal here.`;
  }

  // Both have real readings — check whether they agree
  const momentumBullish = recentMomentum === 'BULLISH';
  const overallBullish = overallDirection === 'ACCUMULATION';

  if (momentumBullish === overallBullish) {
    // AGREE
    if (momentumBullish) {
      return todayPositive
        ? "Today's buying confirms both near-term momentum and the broader accumulation trend — strong bullish alignment."
        : "Despite today's selling, both near-term momentum and the broader trend remain bullish — likely a pause, not a reversal.";
    } else {
      return todayPositive
        ? "Despite today's buying, both near-term momentum and the broader trend remain bearish — likely a bounce, not a reversal."
        : "Today's selling confirms both near-term momentum and the broader distribution trend — strong bearish alignment.";
    }
  } else {
    // DISAGREE
    if (overallBullish) {
      // Recent momentum bearish, but overall trend still net accumulation
      return todayPositive
        ? "Today's buying supports the strong overall accumulation trend, though recent 10-day momentum has been cooling — worth watching for continuation."
        : "Today's selling aligns with cooling recent momentum, even though the broader trend is still net accumulation — an early sign of a possible pullback.";
    } else {
      // Recent momentum bullish, but overall trend still net distribution
      return todayPositive
        ? "Today's buying aligns with improving recent momentum, though the broader trend is still net distribution — could be early signs of a bottoming process."
        : "Today's selling adds to the broader distribution trend, even though recent 10-day momentum had been improving — mixed signals, worth staying cautious.";
    }
  }
}

export function generateADAnalysis(
  symbol: string,
  historicalData: HistoricalData[],
  todayData?: { high: number; low: number; close: number; volume: number }
): ADAnalysis {
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
    
    if (Math.abs(twentyDayAverage) > 0.001) {
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
      const absoluteMoneyFlow = Math.abs(todayMoneyFlow);
      if (todayMoneyFlow > 0) todaySignal = 'ACCUMULATION';
      else todaySignal = 'DISTRIBUTION';
      if (absoluteMoneyFlow > 1000000) todayStrength = 'STRONG';
      else if (absoluteMoneyFlow > 100000) todayStrength = 'MODERATE';
      else todayStrength = 'WEAK';
    } else {
      todaySignal = 'NEUTRAL';
      todayStrength = 'WEAK';
    }
  }
  
  const trendAnalysis = analyzeADTrend(historicalData);
  const overallTrendInfo = calculateOverallTrendStrength(availableData);
  
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
  
  let changePercent = 0;
  if (Math.abs(previousADLine) > 0.001) {
    changePercent = ((currentADLine - previousADLine) / Math.abs(previousADLine)) * 100;
  }
  
  const avgVolumePerDay = availableData.reduce((sum, day) => sum + day.totalVolume, 0) / availableData.length;

  // --- NEW: only generate the combined interpretation once BOTH trend
  // inputs are genuinely ready (20+ real days for both, per our decision
  // to align their thresholds). Below that, keep it simple and honest.
  const bothTrendsReady = trendAnalysis.daysUsed >= 20 && overallTrendInfo.daysUsed >= 20;
  const combinedInterpretation = bothTrendsReady
    ? generateCombinedInterpretation(trendAnalysis.trend, overallTrendInfo.direction, overallTrendInfo.label, todayMoneyFlow)
    : `Still collecting history (${Math.max(trendAnalysis.daysUsed, overallTrendInfo.daysUsed)}/20 days) — showing today's raw money flow only.`;
  
  return {
    todaySignal,
    todayStrength,
    todayMoneyFlow,
    twentyDayAverage,
    avgDaysUsed: availableData.length,
    trend: trendAnalysis.trend,
    confidence: trendAnalysis.confidence,
    trendDaysUsed: trendAnalysis.daysUsed,
    overallTrend: overallTrendInfo.direction,
    trendStrengthPct: overallTrendInfo.strengthPct,
    trendStrengthLabel: overallTrendInfo.label,
    overallTrendDaysUsed: overallTrendInfo.daysUsed,
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
    interpretation: combinedInterpretation
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
      todayVolume: 0,
      volumeVsAverage: 0,
      volumeConfirmation: 'NO'
    },
    interpretation: reason
  };
}
