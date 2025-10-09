// app/page.tsx - UPDATED FRONTEND CODE (with insufficient data handling)
'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ShieldCheck, TrendingUp, BarChart, Briefcase, Mail, Clock, CheckCircle2, XCircle, Info, RefreshCw, ArrowUp, ArrowDown, Calendar, Target, AlertTriangle, CandlestickChart } from 'lucide-react';
import SpeedMeter from '../components/SpeedMeter';

// --- HELPER TYPES ---
type SupportResistanceLevel = {
  price: number;
  strength: 'weak' | 'medium' | 'strong';
  type: 'support' | 'resistance';
  tooltip?: string;
};

type EnhancedSupportResistanceLevel = SupportResistanceLevel & {
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
};

type ADAnalysis = {
  todaySignal: 'ACCUMULATION' | 'DISTRIBUTION' | 'NEUTRAL';
  todayStrength: 'VERY_STRONG' | 'STRONG' | 'MODERATE' | 'WEAK';
  todayMoneyFlow: number;
  twentyDayAverage: number;
  trend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
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
  display?: {
    signal: string;
    moneyFlow: string;
    trend: string;
    confidence: string;
    interpretation: string;
  };
  formattedLines?: string[];
  styling?: {
    signalColor: string;
    strengthColor: string;
    trendIcon: string;
    confidenceIcon: string;
  };
};

type RSIAnalysis = {
  value: number | null;
  signal: string;
  strength: string;
  interpretation: string;
  period: number;
  levels: {
    overbought: number;
    oversold: number;
    neutral: number;
  };
  styling: {
    valueColor: string;
    signalColor: string;
    strengthColor: string;
    trendIcon: string;
  };
  display: {
    value: string;
    signal: string;
    interpretation: string;
    zone: string;
  };
};

type VWAPAnalysis = {
  value: number | null;
  typicalPrice: number;
  cumulativeVolume: number;
  deviationPercent: number;
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  strength: 'STRONG' | 'MODERATE' | 'WEAK';
  interpretation: string;
  styling?: {
    valueColor: string;
    signalColor: string;
    strengthColor: string;
    trendIcon: string;
  };
  display: {
    value: string;
    signal: string;
    deviation: string;
    interpretation: string;
    position: 'ABOVE_VWAP' | 'BELOW_VWAP' | 'AT_VWAP';
  };
  formattedLines?: string[];
};

type AnalysisResult = {
  symbol: string; 
  pcr: number; 
  volumePcr: number;
  maxPain: number; 
  resistance: number;
  support: number;
  sentiment: string;
  sentimentScore?: number;
  sentimentBreakdown?: string[];
  expiryDate: string; 
  ltp: number;
  lastRefreshed: string;
  priceType: string;
  avg20DayVolume?: number;
  todayVolumePercentage?: number;
  estimatedTodayVolume?: number;
  changePercent?: number;
  supports: EnhancedSupportResistanceLevel[];
  resistances: EnhancedSupportResistanceLevel[];
  adAnalysis?: ADAnalysis;
  rsiAnalysis?: RSIAnalysis;
  vwapAnalysis?: VWAPAnalysis;
  insufficientData?: boolean;
  dataSufficiency?: {
    isFullySufficient: boolean;
    indicators: {
      volume: { collected: number; required: number; isReady: boolean };
      adAnalysis: { collected: number; required: number; isReady: boolean };
      rsi: { collected: number; required: number; isReady: boolean };
      vwap: { collected: number; required: number; isReady: boolean };
      pcr: { collected: number; required: number; isReady: boolean };
    };
    totalDaysCollected: number;
  };
};

type MarketStatus = 'OPEN' | 'PRE_MARKET' | 'CLOSED' | 'UNKNOWN';
type AppError = { message: string; type: string; timestamp: Date; };
type LoadingState = 'IDLE' | 'FETCHING_SYMBOLS' | 'ANALYZING' | 'REFRESHING';

// --- CONSTANTS AND HELPERS ---
const marketHolidays2025 = new Set(['2025-01-26', '2025-02-26', '2025-03-14', '2025-03-31', '2025-04-10', '2025-04-14', '2025-04-18', '2025-05-01', '2025-06-07', '2025-08-15', '2025-08-27', '2025-10-02', '2025-10-21', '2025-10-22', '2025-11-05', '2025-12-25']);
const marketHolidaysWithNames: { [key: string]: string } = { '2025-01-26': 'Republic Day', '2025-02-26': 'Maha Shivratri', '2025-03-14': 'Holi', '2025-03-31': 'Id-Ul-Fitr (Ramzan Id)', '2025-04-10': 'Shri Mahavir Jayanti', '2025-04-14': 'Dr. Baba Saheb Ambedkar Jayanti', '2025-04-18': 'Good Friday', '2025-05-01': 'Maharashtra Day', '2025-06-07': 'Bakri Id', '2025-08-15': 'Independence Day', '2025-08-27': 'Shri Ganesh Chaturthi', '2025-10-02': 'Mahatma Gandhi Jayanti', '2025-10-21': 'Diwali Laxmi Pujan', '2025-10-22': 'Balipratipada', '2025-11-05': 'Gurunanak Jayanti', '2025-12-25': 'Christmas' };

// Helper functions
const formatMoneyFlow = (flow: number): string => {
  if (flow === undefined || flow === null || isNaN(flow)) return '0';
  if (Math.abs(flow) >= 1000000) return `${(flow / 1000000).toFixed(1)}M`;
  if (Math.abs(flow) >= 1000) return `${(flow / 1000).toFixed(1)}K`;
  return flow.toFixed(0);
};

const formatOIChange = (change: number): string => {
  if (change > 0) return `+${change.toFixed(1)}%`;
  if (change < 0) return `${change.toFixed(1)}%`;
  return '0%';
};

const getOITrendIcon = (trend: string): string => {
  switch (trend) {
    case 'BUILDING': return '↗️';
    case 'DECLINING': return '↘️';
    case 'STABLE': return '➡️';
    default: return '➡️';
  }
};

const getOITrendColor = (trend: string): string => {
  switch (trend) {
    case 'BUILDING': return 'text-green-400';
    case 'DECLINING': return 'text-red-500';
    case 'STABLE': return 'text-gray-400';
    default: return 'text-gray-400';
  }
};

const getOISignificanceColor = (significance: string): string => {
  switch (significance) {
    case 'HIGH': return 'text-red-500 font-semibold';
    case 'MEDIUM': return 'text-yellow-500';
    case 'LOW': return 'text-gray-500';
    default: return 'text-gray-500';
  }
};

const isAnalysisResult = (data: unknown): data is AnalysisResult => {
  try {
    const typedData = data as AnalysisResult;
    const supportsIsValid = Array.isArray(typedData.supports) && (typedData.supports.length === 0 || (typeof typedData.supports[0] === 'object' && typedData.supports[0] !== null && 'price' in typedData.supports[0]));
    const resistancesIsValid = Array.isArray(typedData.resistances) && (typedData.resistances.length === 0 || (typeof typedData.resistances[0] === 'object' && typedData.resistances[0] !== null && 'price' in typedData.resistances[0]));
    
    const adAnalysisIsValid = !typedData.adAnalysis || (typeof typedData.adAnalysis === 'object' && typedData.adAnalysis !== null);
    const rsiAnalysisIsValid = !typedData.rsiAnalysis || (typeof typedData.rsiAnalysis === 'object' && typedData.rsiAnalysis !== null);
    const vwapAnalysisIsValid = !typedData.vwapAnalysis || (typeof typedData.vwapAnalysis === 'object' && typedData.vwapAnalysis !== null);
    
    return (!!typedData && 
            typeof typedData.symbol === 'string' && 
            typeof typedData.pcr === 'number' && 
            typeof typedData.ltp === 'number' && 
            typeof typedData.priceType === 'string' &&
            supportsIsValid && 
            resistancesIsValid &&
            adAnalysisIsValid &&
            rsiAnalysisIsValid &&
            vwapAnalysisIsValid);
  } catch (error) { 
    console.error('Validation error:', error); 
    return false; 
  }
};

const getNextWorkingDay = (currentDate: Date): string => {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const nextDay = new Date(currentDate);
  do {
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDayKey = `${nextDay.getUTCFullYear()}-${String(nextDay.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDay.getUTCDate()).padStart(2, '0')}`;
    if (nextDay.getUTCDay() !== 0 && nextDay.getUTCDay() !== 6 && !marketHolidays2025.has(nextDayKey)) return days[nextDay.getUTCDay()];
  } while (true);
};

const getAdvancedPcrSentiment = (pcrValue: number, type: 'OI' | 'VOLUME'): { sentiment: string, color: string } => {
  if (type === 'OI') {
    if (pcrValue > 1.3) return { sentiment: 'Highly Bullish', color: 'text-green-400' };
    if (pcrValue > 1.1) return { sentiment: 'Slightly Bullish', color: 'text-green-300' };
    if (pcrValue < 0.7) return { sentiment: 'Highly Bearish', color: 'text-red-500' };
    if (pcrValue < 0.9) return { sentiment: 'Slightly Bearish', color: 'text-red-400' };
    return { sentiment: 'Neutral', color: 'text-gray-400' };
  } else {
    if (pcrValue < 0.7) return { sentiment: 'Highly Bullish', color: 'text-green-400' };
    if (pcrValue < 0.9) return { sentiment: 'Slightly Bullish', color: 'text-green-300' };
    if (pcrValue > 1.3) return { sentiment: 'Highly Bearish', color: 'text-red-500' };
    if (pcrValue > 1.1) return { sentiment: 'Slightly Bearish', color: 'text-red-400' };
    return { sentiment: 'Neutral', color: 'text-gray-400' };
  }
};

const getStrengthColor = (strength: string): string => {
  switch (strength) {
    case 'VERY_STRONG': return 'text-green-400';
    case 'STRONG': return 'text-green-300';
    case 'MODERATE': return 'text-yellow-400';
    case 'WEAK': return 'text-gray-400';
    default: return 'text-gray-400';
  }
};

const getSignalIcon = (signal: string) => {
  switch (signal) {
    case 'ACCUMULATION': return <ArrowUp size={20} className="text-green-400" />;
    case 'DISTRIBUTION': return <ArrowDown size={20} className="text-red-500" />;
    default: return <TrendingUp size={20} className="text-gray-400" />;
  }
};

const getTrendIcon = (trend: string) => {
  switch (trend) {
    case 'BULLISH': return '📈';
    case 'BEARISH': return '📉';
    default: return '➡️';
  }
};

// --- HELPER COMPONENTS ---
const ErrorToast = React.memo(({ error }: { error: AppError }) => ( 
  <div className={`fixed top-4 right-4 p-4 rounded-lg shadow-lg border-l-4 ${ 
    error.type === 'NETWORK' ? 'border-red-500 bg-red-900/50' : 
    'border-gray-500 bg-gray-900/50' 
  } backdrop-blur-sm z-50 max-w-md`}>
    <div className="flex items-start"><XCircle size={20} className="mr-2 flex-shrink-0 mt-0.5" /><p className="text-sm">{error.message}</p></div>
  </div> 
));
ErrorToast.displayName = 'ErrorToast';

const DataCard = React.memo(({ icon: Icon, title, value, color = 'text-white', tooltip, subValue, sentimentColor }: { 
  icon?: React.ElementType;
  title: string; 
  value: number | string; 
  color?: string; 
  tooltip?: string; 
  subValue?: string;
  sentimentColor?: string;
}) => ( 
  <div className="bg-gray-900/50 p-4 rounded-lg text-center h-full flex flex-col justify-center min-h-[140px]">
    <div className="flex items-center justify-center text-sm text-gray-400">
      {Icon && <Icon size={14} className="mr-1.5" />}
      <span>{title}</span>
      {tooltip && (
        <div className="relative group ml-1">
          <Info size={14} className="cursor-pointer" />
          <div className="absolute bottom-full mb-2 w-64 p-2 text-xs text-left text-white bg-gray-900 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
            {tooltip}
          </div>
        </div>
      )}
    </div>
    <p className={`text-3xl font-bold ${color}`}>{typeof value === 'number' ? value.toFixed(2) : value}</p>
    {subValue && (
      <p className={`text-sm mt-1 ${sentimentColor}`}>{subValue}</p>
    )}
  </div>
));
DataCard.displayName = 'DataCard';

const SupportResistanceList = React.memo(({ levels, type }: { levels: EnhancedSupportResistanceLevel[], type: 'Support' | 'Resistance' }) => {
  const isSupport = type === 'Support';
  const headerColor = isSupport ? 'text-green-400' : 'text-red-500';

  const getStrengthColor = (strength: string) => {
    switch (strength) {
      case 'strong': return 'bg-gray-700 text-white';
      case 'medium': return 'bg-gray-800 text-gray-300';
      case 'weak': return 'bg-gray-900 text-gray-500';
      default: return 'bg-gray-800 text-gray-300';
    }
  };

  if (!levels || levels.length === 0) {
    return (
      <div className="bg-gray-900/50 p-4 rounded-lg h-full min-h-[140px] flex flex-col justify-center">
        <h3 className={`text-lg font-bold text-center mb-2 ${headerColor}`}>{type} Levels</h3>
        <p className="text-gray-500 text-center text-sm">No significant levels found.</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900/50 p-4 rounded-lg h-full min-h-[140px]">
      <h3 className={`text-lg font-bold text-center mb-4 ${headerColor}`}>{type} Levels</h3>
      <div className="space-y-2">
        {levels.map((level) => (
          <div key={level.price} className='p-2 rounded-md'>
            <div className="flex justify-between items-center">
              <span className={`text-xl font-bold ${headerColor}`}>{level.price}</span>
              <div className="flex items-center">
                <span className={`text-xs font-semibold uppercase px-2 py-1 rounded ${getStrengthColor(level.strength)}`}>
                  {level.strength}
                </span>
                {level.oiTrend && (
                  <span className={`ml-2 text-xs font-semibold ${getOITrendColor(level.oiTrend.direction)}`}>
                    {level.oiTrend.icon} {formatOIChange(level.oiTrend.changePercent)}
                  </span>
                )}
                {level.tooltip && (
                  <div className="relative group">
                    <Info size={14} className="ml-2 text-gray-400 cursor-pointer" />
                    <div className="absolute bottom-full mb-2 right-0 w-64 p-2 text-xs text-left text-white bg-gray-900 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
                      {level.tooltip}
                      {level.oiTrend && (
                        <>
                          <br />
                          <br />
                          OI Trend: {level.oiTrend.direction} ({formatOIChange(level.oiTrend.changePercent)})
                          <br />
                          Significance: {level.oiTrend.significance}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
            {level.currentOI && (
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>
                  {isSupport ? 'PE' : 'CE'}: {(level.currentOI[isSupport ? 'pe_oi' : 'ce_oi'] / 100000).toFixed(1)}L
                  {level.oiTrend && level.oiTrend.direction !== 'STABLE' && (
                    <span className={`ml-1 ${getOITrendColor(level.oiTrend.direction)}`}>
                      {level.oiTrend.icon}
                    </span>
                  )}
                </span>
                <span>
                  {isSupport ? 'CE' : 'PE'}: {(level.currentOI[isSupport ? 'ce_oi' : 'pe_oi'] / 100000).toFixed(1)}L
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});
SupportResistanceList.displayName = 'SupportResistanceList';

const ADLineAnalysisCard = React.memo(({ adAnalysis, marketStatus }: { adAnalysis?: ADAnalysis; marketStatus: MarketStatus }) => {
  if (!adAnalysis) {
    return (
      <div className="bg-gray-900/50 p-4 rounded-lg text-center h-full flex flex-col justify-center min-h-[140px]">
        <div className="flex items-center justify-center text-sm text-gray-400">
          <TrendingUp size={14} className="mr-1.5" />
          <span>A/D Line Analysis</span>
          <div className="relative group ml-1">
            <Info size={14} className="cursor-pointer" />
            <div className="absolute bottom-full mb-2 w-72 p-2 text-xs text-left text-white bg-gray-900 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
              Accumulation/Distribution Line tracks money flow by comparing closing price to high/low range.
              <br />Shows institutional buying/selling pressure.
              <br />Data available during market hours.
            </div>
          </div>
        </div>
        <p className="text-gray-500 text-sm mt-2">Data not available yet</p>
        <p className="text-gray-600 text-xs">Check during market hours</p>
      </div>
    );
  }

  const signalIcon = getSignalIcon(adAnalysis.todaySignal || 'NEUTRAL');
  const strengthColor = getStrengthColor(adAnalysis.todayStrength || 'WEAK');
  const trendIcon = getTrendIcon(adAnalysis.trend || 'SIDEWAYS');
  
  const todayMoneyFlow = adAnalysis.todayMoneyFlow || 0;
  const twentyDayAverage = adAnalysis.twentyDayAverage || 0;
  const trend = adAnalysis.trend || 'SIDEWAYS';
  const confidence = adAnalysis.confidence || 'LOW';
  const interpretation = adAnalysis.interpretation || 'Analysis data not available';

  const displayLines = adAnalysis.formattedLines || [
    `💰 Money Flow: ${todayMoneyFlow >= 0 ? '+' : ''}${formatMoneyFlow(todayMoneyFlow)} vs ${formatMoneyFlow(twentyDayAverage)} average`,
    `📊 20-Day Trend: ${trend}`,
    `🎯 Confidence: ${confidence}`,
    ``,
    `💡 ${interpretation}`
  ];

  return (
    <div className="bg-gray-900/50 p-4 rounded-lg text-center h-full flex flex-col justify-center min-h-[140px]">
      <div className="flex items-center justify-center text-sm text-gray-400">
        <TrendingUp size={14} className="mr-1.5" />
        <span>A/D Line Analysis</span>
        <div className="relative group ml-1">
          <Info size={14} className="cursor-pointer" />
          <div className="absolute bottom-full mb-2 w-72 p-2 text-xs text-left text-white bg-gray-900 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
            Accumulation/Distribution Line tracks money flow by comparing closing price to high/low range.
            <br />Shows institutional buying/selling pressure.
            <br /><br />
            Signal: {adAnalysis.todaySignal || 'NEUTRAL'} ({adAnalysis.todayStrength || 'WEAK'})
            <br />Money Flow: {todayMoneyFlow >= 0 ? '+' : ''}{formatMoneyFlow(todayMoneyFlow)}
            <br />Trend: {trend} ({confidence} confidence)
          </div>
        </div>
      </div>
      
      <div className="flex items-center justify-center mt-2">
        
        <span 
          className="text-lg font-bold ml-2" 
          style={{ color: adAnalysis.styling?.signalColor || '#6b7280' }}
        >
          Today's Signal: {adAnalysis.todaySignal || 'NEUTRAL'} ({adAnalysis.todayStrength || 'WEAK'})
        </span>
      </div>

      
      <div className="text-xs space-y-1 mt-2 text-left">
        {displayLines.slice(0, 4).map((line, index) => (
          <div key={index} className="flex items-start">
            <span className="flex-shrink-0 mr-1">{line.split(' ')[0]}</span>
            <span>{line.substring(line.indexOf(' ') + 1)}</span>
          </div>
        ))}
      </div>
      
      <div className="text-xs mt-2 text-gray-400 text-left" style={{ textAlign: 'center' }}>
        {interpretation}
      </div>
    </div>
  );
});
ADLineAnalysisCard.displayName = 'ADLineAnalysisCard';

const RSIAnalysisCard = React.memo(({ rsiAnalysis }: { rsiAnalysis?: RSIAnalysis }) => {
  if (!rsiAnalysis || rsiAnalysis.value === null) {
    return (
      <div className="bg-gray-900/50 p-4 rounded-lg text-center h-full flex flex-col justify-center min-h-[140px]">
        <div className="flex items-center justify-center text-sm text-gray-400">
          <span>RSI Analysis</span>
          <div className="relative group ml-1">
            <Info size={14} className="cursor-pointer" />
            <div className="absolute bottom-full mb-2 w-72 p-2 text-xs text-left text-white bg-gray-900 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
              Relative Strength Index (14-period) measures momentum and overbought/oversold conditions.
              <br />Values above 70 indicate overbought, below 30 indicate oversold.
              <br />Requires sufficient historical data for calculation.
            </div>
          </div>
        </div>
        <p className="text-gray-500 text-sm mt-2">Insufficient data for RSI calculation</p>
      </div>
    );
  }

  const getRSIBarWidth = (value: number) => {
    if (value <= 30) return (value / 30) * 33;
    if (value <= 70) return 33 + ((value - 30) / 40) * 34;
    return 67 + ((value - 70) / 30) * 33;
  };

  return (
    <div className="bg-gray-900/50 p-4 rounded-lg text-center h-full flex flex-col justify-center min-h-[140px]">
      <div className="flex items-center justify-center text-sm text-gray-400">
        <span>RSI Analysis (14-period)</span>
        <div className="relative group ml-1">
          <Info size={14} className="cursor-pointer" />
          <div className="absolute bottom-full mb-2 w-72 p-2 text-xs text-left text-white bg-gray-900 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
            Relative Strength Index (14-period) measures momentum and overbought/oversold conditions.
            <br />Values above 70 indicate overbought, below 30 indicate oversold.
            <br />Current: {rsiAnalysis.value} - {rsiAnalysis.display.zone}
          </div>
        </div>
      </div>
      
      <div className="flex items-center justify-between mt-2">
        <span className="text-lg font-bold" style={{ color: rsiAnalysis.styling.valueColor }}>
          {rsiAnalysis.value}
        </span>
        <span 
          className="text-sm font-semibold px-2 py-1 rounded"
          style={{ 
            color: rsiAnalysis.styling.signalColor,
            backgroundColor: `${rsiAnalysis.styling.signalColor}20`
          }}
        >
          {rsiAnalysis.display.signal}
        </span>
      </div>

      {/* RSI Visual Bar */}
      <div className="rsi-bar-container bg-gray-100 rounded-full h-3 relative mt-2">
        <div className="rsi-bar-levels flex justify-between absolute w-full top-0 text-xs px-1 py-0.5">
          <span className="text-gray-600">0</span>
          <span className="text-gray-600">30</span>
          <span className="text-gray-600">50</span>
          <span className="text-gray-600">70</span>
          <span className="text-gray-600">100</span>
        </div>
        <div 
          className="rsi-bar-progress h-3 rounded-full bg-gradient-to-r from-green-500 via-yellow-500 to-red-500 absolute"
          style={{ width: `${getRSIBarWidth(rsiAnalysis.value)}%` }}
        ></div>
        <div 
          className="rsi-bar-marker w-2 h-4 bg-black rounded-full absolute -top-0.5 -ml-1"
          style={{ left: `${getRSIBarWidth(rsiAnalysis.value)}%` }}
        ></div>
      </div>

      {/* Zones */}
      <div className="rsi-zones flex justify-between text-xs font-medium mt-1">
        <span className="text-green-600">Oversold</span>
        <span className="text-yellow-600">Neutral</span>
        <span className="text-red-600">Overbought</span>
      </div>

      <div className="text-xs mt-2 text-gray-400 text-left" style={{ textAlign: 'center' }}>
        {rsiAnalysis.interpretation}
      </div>
    </div>
  );
});
RSIAnalysisCard.displayName = 'RSIAnalysisCard';

const VWAPAnalysisCard = React.memo(({ vwapAnalysis }: { vwapAnalysis?: VWAPAnalysis }) => {
  if (!vwapAnalysis || vwapAnalysis.value === null) {
    return (
      <div className="bg-gray-900/50 p-4 rounded-lg text-center h-full flex flex-col justify-center min-h-[140px]">
        <div className="flex items-center justify-center text-sm text-gray-400">
          <TrendingUp size={14} className="mr-1.5" />
          <span>VWAP Analysis</span>
          <div className="relative group ml-1">
            <Info size={14} className="cursor-pointer" />
            <div className="absolute bottom-full mb-2 w-64 p-2 text-xs text-left text-white bg-gray-900 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
              Volume Weighted Average Price (VWAP) tracks the average price weighted by volume.
              <br />Trading above VWAP suggests bullish bias, below suggests bearish bias.
              <br />Used by institutions to identify fair value.
            </div>
          </div>
        </div>
        <p className="text-gray-500 text-sm mt-2">Calculating VWAP...</p>
        <p className="text-gray-600 text-xs">Market data required</p>
      </div>
    );
  }

  const getDeviationColor = (deviation: number) => {
    if (deviation > 1.0) return 'text-green-400';
    if (deviation < -1.0) return 'text-red-500';
    return 'text-gray-400';
  };

  const getPositionIcon = (position: string) => {
    switch (position) {
      case 'ABOVE_VWAP': return <ArrowUp size={16} className="text-green-400" />;
      case 'BELOW_VWAP': return <ArrowDown size={16} className="text-red-500" />;
      default: return <TrendingUp size={16} className="text-gray-400" />;
    }
  };

  const getStrengthBadge = (strength: string) => {
    switch (strength) {
      case 'STRONG': return 'bg-green-900/50 text-green-400 border border-green-700';
      case 'MODERATE': return 'bg-yellow-900/50 text-yellow-400 border border-yellow-700';
      case 'WEAK': return 'bg-gray-700 text-gray-400 border border-gray-600';
      default: return 'bg-gray-700 text-gray-400 border border-gray-600';
    }
  };

  return (
    <div className="bg-gray-900/50 p-4 rounded-lg text-center h-full flex flex-col justify-center min-h-[140px]">
      <div className="flex items-center justify-center text-sm text-gray-400">
        <TrendingUp size={14} className="mr-1.5" />
        <span>VWAP Analysis</span>
        <div className="relative group ml-1">
          <Info size={14} className="cursor-pointer" />
          <div className="absolute bottom-full mb-2 w-72 p-2 text-xs text-left text-white bg-gray-900 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
            Volume Weighted Average Price (VWAP) tracks the average price weighted by volume.
            <br />Trading above VWAP suggests bullish bias, below suggests bearish bias.
            <br /><br />
            Current VWAP: ₹{vwapAnalysis.value?.toFixed(2) || 'Calculating...'}
            <br />LTP Position: {vwapAnalysis.deviationPercent >= 0 ? 'ABOVE' : 'BELOW'} VWAP
            <br />Signal: {vwapAnalysis.signal} ({vwapAnalysis.strength})
          </div>
        </div>
      </div>
      
      {/* VWAP Value and Signal */}
      <div className="flex items-center justify-between mt-2">
        <span className="text-lg font-bold text-white">
          ₹{vwapAnalysis.value?.toFixed(2)}
        </span>
        <div className="flex items-center">
          {getPositionIcon(vwapAnalysis.display.position)}
          <span 
            className={`text-sm font-semibold ml-1 px-2 py-1 rounded ${getStrengthBadge(vwapAnalysis.strength)}`}
          >
            {vwapAnalysis.signal}
          </span>
        </div>
      </div>

      {/* Deviation from VWAP */}
      <div className="flex items-center justify-center mt-2">
        <span className={`text-md font-semibold ${getDeviationColor(vwapAnalysis.deviationPercent)}`}>
          {vwapAnalysis.deviationPercent >= 0 ? '+' : ''}{vwapAnalysis.deviationPercent.toFixed(2)}%
        </span>
        <span className="text-gray-400 text-sm ml-1">
          {vwapAnalysis.deviationPercent > 0 ? 'above' : vwapAnalysis.deviationPercent < 0 ? 'below' : 'at'} VWAP
        </span>
      </div>

      {/* Volume Context */}
      {vwapAnalysis.cumulativeVolume > 0 && (
        <div className="text-xs text-gray-400 mt-1">
          Volume: {(vwapAnalysis.cumulativeVolume / 1000).toFixed(1)}K shares
        </div>
      )}

      {/* Interpretation */}
      <div className="text-xs mt-2 text-gray-400 text-left" style={{ textAlign: 'center' }}>
        {vwapAnalysis.interpretation}
      </div>
    </div>
  );
});
VWAPAnalysisCard.displayName = 'VWAPAnalysisCard';

const FeatureCard = React.memo(({ icon, title, description }: { icon: React.ReactElement, title: string, description: string }) => ( 
  <div className="bg-brand-light-dark/50 backdrop-blur-sm border border-white/10 p-6 rounded-xl text-center transition-all duration-300 hover:bg-white/10 hover:scale-105">
    <div className="inline-block p-4 bg-gray-900/50 rounded-full mb-4 text-brand-cyan">
      {icon}
    </div>
    <h3 className="text-xl font-bold mb-2 text-white">{title}</h3>
    <p className="text-gray-400">{description}</p>
  </div> 
));
FeatureCard.displayName = 'FeatureCard';

const VolumeCard = React.memo(({ 
  avg20DayVolume, 
  todayVolumePercentage, 
  estimatedTodayVolume,
  marketStatus,
  symbol
}: { 
  avg20DayVolume?: number;
  todayVolumePercentage?: number;
  estimatedTodayVolume?: number;
  marketStatus: MarketStatus;
  symbol?: string;
}) => {
  const formatVolume = (volume: number) => {
    if (volume === undefined || volume === null || isNaN(volume)) return '0';
    if (volume >= 1000000) return `${(volume / 1000000).toFixed(1)}M`;
    if (volume >= 1000) return `${(volume / 1000).toFixed(1)}K`;
    return volume.toString();
  };

  const getPercentageColor = (percentage: number) => {
    if (percentage === undefined || percentage === null || isNaN(percentage)) return 'text-gray-400';
    if (percentage > 100) return 'text-green-400';
    if (percentage > 75) return 'text-yellow-400';
    if (percentage > 50) return 'text-orange-400';
    return 'text-red-400';
  };

  const isMarketOpen = marketStatus === 'OPEN';
  const hasVolumeData = todayVolumePercentage !== undefined && todayVolumePercentage !== null;

  return (
    <div className="bg-gray-900/50 p-4 rounded-lg text-center h-full flex flex-col justify-center">
      <div className="flex items-center justify-center text-sm text-gray-400">
        <span>Volume Analysis</span>
        <div className="relative group ml-1">
          <Info size={14} className="cursor-pointer" />
          <div className="absolute bottom-full mb-2 w-64 p-2 text-xs text-left text-white bg-gray-900 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
            {isMarketOpen 
              ? "Compares today's volume against 20-day average. Percentage shows progress vs daily average. Estimated projects full day volume."
              : "Historical 20-day average volume and last trading day's volume data."}
          </div>
        </div>
      </div>
      
      {/* 20-Day Average - Always Show */}
      {avg20DayVolume !== undefined && avg20DayVolume > 0 && (
        <p className="text-lg font-semibold text-white mt-2">
          20D Avg: {formatVolume(avg20DayVolume)}
        </p>
      )}
      
      {/* Market Hours - Live Data */}
      {isMarketOpen && hasVolumeData ? (
        <>
          <p className={`text-xl font-bold ${getPercentageColor(todayVolumePercentage)} mt-2`}>
            Today: 📊 {todayVolumePercentage.toFixed(1)}% of Avg
          </p>
          {estimatedTodayVolume !== undefined && estimatedTodayVolume > 0 && (
            <p className="text-md text-gray-300 mt-2">
              Est. Today: {formatVolume(estimatedTodayVolume)}
            </p>
          )}
        </>
      ) : 
      /* Non-Market Hours - Historical Data */
      hasVolumeData ? (
        <p className={`text-xl font-bold ${getPercentageColor(todayVolumePercentage)} mt-2`}>
          Last Volume: {formatVolume(estimatedTodayVolume || 0)} ({todayVolumePercentage.toFixed(1)}% of Avg)
        </p>
      ) : (
        /* No Data Available */
        <div className="mt-2">
          <p className="text-yellow-400 text-sm mb-1">
            Volume data unavailable
          </p>
        </div>
      )}
    </div>
  );
});
VolumeCard.displayName = 'VolumeCard';

const PCRStatCard = React.memo(({ title, value, sentiment, sentimentColor }: { 
  title: string; 
  value: number;
  sentiment?: string; 
  sentimentColor?: string; 
}) => (
  <div className="bg-gray-900/50 p-4 rounded-lg text-center h-full flex flex-col justify-center min-h-[140px]">
    <div className="flex items-center justify-center text-sm text-gray-400">
      <span>{title}</span>
      <div className="relative group ml-1">
        <Info size={14} className="cursor-pointer" />
        <div className="absolute bottom-full mb-2 w-64 p-2 text-xs text-left text-white bg-gray-900 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
          {title === 'OI PCR Ratio' 
            ? 'Put-Call Ratio based on Open Interest. High (>1.1) is bullish, low (<0.9) is bearish.'
            : "Put-Call Ratio based on today's trading volume. Low (<0.9) is bullish, high (>1.1) is bearish."}
        </div>
      </div>
    </div>
    <p className={`text-3xl font-bold text-white`}>{value.toFixed(2)}</p>
    {sentiment && sentimentColor && (
      <p className={`text-sm font-semibold mt-1 ${sentimentColor}`}>{sentiment}</p>
    )}
  </div>
));
PCRStatCard.displayName = 'PCRStatCard';

const ProgressiveDataCard = React.memo(({ 
  title, 
  collected, 
  required,
  isReady,
  children,
  liveData = false
}: { 
  title: string;
  collected: number;
  required: number;
  isReady: boolean;
  children: React.ReactNode;
  liveData?: boolean;
}) => {
  if (isReady) {
    return (
      <div className="bg-gray-900/50 p-4 rounded-lg text-center h-full flex flex-col justify-center min-h-[140px] border border-green-500/30">
        <div className="flex items-center justify-center text-sm text-green-400 mb-2">
          <CheckCircle2 size={16} className="mr-2" />
          <span>{title} {liveData ? '✅ LIVE' : `✅ (${collected}/${required} days)`}</span>
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="bg-gray-900/50 p-4 rounded-lg text-center h-full flex flex-col justify-center min-h-[140px] border border-yellow-500/30">
      <div className="flex items-center justify-center text-sm text-yellow-400 mb-2">
        <span>{title} {!isReady && `(${collected}/${required} days)`}</span>
      </div>
      {!isReady && (
      <div className="text-red-400 text-sm font-semibold mb-2">
        ❌ Need {required - collected} more day{required - collected !== 1 ? 's' : ''}
      </div>
      )}
      {collected > 0 && (
        <div className="text-xs text-gray-400">
          {Math.round((collected / required) * 100)}% complete
        </div>
      )}
    </div>
  );
});
ProgressiveDataCard.displayName = 'ProgressiveDataCard';

// === MAIN COMPONENT ===
export default function Home() {
  const [symbolList, setSymbolList] = useState<string[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<AnalysisResult | null>(null);
  const [marketStatus, setMarketStatus] = useState<MarketStatus>('UNKNOWN');
  const [marketMessage, setMarketMessage] = useState('');
  const [refreshingCard, setRefreshingCard] = useState(false);
  const [errors, setErrors] = useState<AppError[]>([]);
  const [loadingState, setLoadingState] = useState<LoadingState>('IDLE');
  const [lastRequestTime, setLastRequestTime] = useState(0);
  const [cooldownMessage, setCooldownMessage] = useState('');
  const [apiError, setApiError] = useState('');

  useEffect(() => { 
    const savedSymbol = localStorage.getItem('selectedSymbol'); 
    if (savedSymbol) setSelectedSymbol(savedSymbol); 
  }, []);

  useEffect(() => { 
    if (selectedSymbol) localStorage.setItem('selectedSymbol', selectedSymbol); 
  }, [selectedSymbol]);
  
  const addError = useCallback((message: string, type: string = 'UNKNOWN') => { 
    console.error(`Error [${type}]:`, message); 
    setErrors(prev => [{ message, type, timestamp: new Date() } as AppError, ...prev]); 
  }, []);

  useEffect(() => { 
    if (errors.length > 0) { 
      const timer = setTimeout(() => setErrors(prev => prev.slice(0, prev.length - 1)), 5000); 
      return () => clearTimeout(timer); 
    } 
  }, [errors]);

  const fetchWithRetry = useCallback(async (url: string, options: RequestInit = {}, retries = 2): Promise<Response> => { 
    try { 
      const response = await fetch(url, options); 
      if (response.status === 401) throw new Error('TOKEN_EXPIRED'); 
      if (response.status === 404) throw new Error('SYMBOL_NOT_FOUND'); 
      if (!response.ok) throw new Error(`HTTP ${response.status}`); 
      return response; 
    } catch (error) { 
      if (retries > 0 && !(error instanceof Error && (error.message === 'TOKEN_EXPIRED' || error.message === 'SYMBOL_NOT_FOUND'))) { 
        await new Promise(resolve => setTimeout(resolve, 1000)); 
        return fetchWithRetry(url, options, retries - 1); 
      } 
      throw error; 
    } 
  }, []);

  const getNextMarketOpenTime = useCallback((currentTime: Date): string => { 
    const istTime = new Date(currentTime.getTime() + (5.5 * 60 * 60 * 1000)); 
    const day = istTime.getUTCDay(); 
    const hours = istTime.getUTCHours(); 
    const minutes = istTime.getUTCMinutes(); 
    if (day === 0 || day === 6) return "Monday 9:15 AM"; 
    if (hours >= 15 || (hours === 15 && minutes >= 30)) return day === 5 ? "Monday 9:15 AM" : "Tomorrow 9:15 AM"; 
    if (hours < 9 || (hours === 9 && minutes < 15)) return "Today 9:15 AM"; 
    return "9:15 AM"; 
  }, []);

  const symbolOptions = useMemo(() => { 
    if (symbolList.length === 0) return <option>Loading symbols...</option>; 
    return symbolList.map(s => <option key={s} value={s}>{s}</option>); 
  }, [symbolList]);

  useEffect(() => {
    const checkMarketStatus = () => { 
      const now = new Date(); 
      const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const day = istTime.getDay();
      const hours = istTime.getHours();
      const minutes = istTime.getMinutes();
      
      const todayKey = `${istTime.getFullYear()}-${String(istTime.getMonth() + 1).padStart(2, '0')}-${String(istTime.getDate()).padStart(2, '0')}`;
      
      if (marketHolidays2025.has(todayKey)) {
        setMarketStatus('CLOSED'); 
        setMarketMessage(`Market closed for ${marketHolidaysWithNames[todayKey]}. Opens ${getNextWorkingDay(istTime)} at 9:15 AM`); 
        return; 
      } 
      
      if (day === 0 || day === 6) {
        setMarketStatus('CLOSED'); 
        setMarketMessage(`Market closed for weekend. Opens Monday at 9:15 AM`); 
        return; 
      } 
      
      const timeInMinutes = hours * 60 + minutes; 
      
      if (timeInMinutes >= (9 * 60) && timeInMinutes < (9 * 60 + 15)) {
        setMarketStatus('PRE_MARKET');
        setMarketMessage('Pre-market hours. Live data available at 9:15 AM');
      }
      else if (timeInMinutes >= (9 * 60 + 15) && timeInMinutes <= (15 * 60 + 30)) {
        setMarketStatus('OPEN');
        setMarketMessage('Market is open');
      }
      else {
        setMarketStatus('CLOSED');
        setMarketMessage(`Market closed. Opens ${getNextMarketOpenTime(now)}`);
      }
    };

    const fetchSymbols = async () => { 
      setLoadingState('FETCHING_SYMBOLS'); 
      try { 
        const response = await fetchWithRetry('/api/get-symbols'); 
        const data: string[] = await response.json(); 
        setSymbolList(data); 
        if (!selectedSymbol && data.length > 0) { 
          const savedSymbol = localStorage.getItem('selectedSymbol'); 
          setSelectedSymbol(savedSymbol && data.includes(savedSymbol) ? savedSymbol : data.includes('NIFTY') ? 'NIFTY' : data[0]); 
        } 
      } catch (error) { 
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        addError(errorMessage, 'NETWORK'); 
      } finally { 
        setLoadingState('IDLE'); 
      } 
    };

    checkMarketStatus(); 
    fetchSymbols(); 
    const interval = setInterval(checkMarketStatus, 60000); 
    return () => clearInterval(interval);
  }, [addError, getNextMarketOpenTime, selectedSymbol]);

  const performAnalysis = useCallback(async (symbolToAnalyze: string) => { 
    if (!symbolToAnalyze) return;
    const currentTime = Date.now();
    if (lastRequestTime > 0 && currentTime - lastRequestTime < 10000) {
      setCooldownMessage('Please wait 10 seconds before another request.');
      setTimeout(() => setCooldownMessage(''), 3000);
      return; 
    } 
    
    setIsLoading(true);
    setLoadingState('ANALYZING');
    setApiError(''); 
    setCooldownMessage('');

    try { 
      const response = await fetchWithRetry('/api/analyze', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ symbol: symbolToAnalyze }), 
      }); 
      const data = await response.json(); 
      console.log('🔍 RAW API RESPONSE:', JSON.stringify(data, null, 2));
      if (data.insufficientData || data.dataSufficiency?.isFullySufficient === false) {
        setResults({
          ...data,
          insufficientData: true
        });
        const daysCollected = data.dataSufficiency?.totalDaysCollected || 0;
        const readyIndicators = Object.values(data.dataSufficiency?.indicators || {}).filter((ind: any) => ind.isReady).length;
        const totalIndicators = Object.values(data.dataSufficiency?.indicators || {}).length;
        setApiError(`Data collection: ${daysCollected} days | ${readyIndicators}/${totalIndicators} indicators ready`);
      } else if (!isAnalysisResult(data)) {
        console.error('❌ Validation failed. Data structure:', JSON.stringify(data, null, 2));
        throw new Error('Invalid response format from server.');
      } else {
        setResults(data); 
      }
      
      setLastRequestTime(currentTime); 
    } catch (error) { 
      if (error instanceof Error && error.message.includes('INSUFFICIENT_DATA')) {
        setApiError('New stock detected. Data collection in progress (0/5 days)');
        setResults({
          symbol: selectedSymbol,
          pcr: 1.0,
          volumePcr: 1.0,
          maxPain: 0,
          resistance: 0,
          support: 0,
          sentiment: 'NEUTRAL',
          expiryDate: 'N/A',
          ltp: 0,
          lastRefreshed: new Date().toISOString(),
          priceType: 'LTP',
          supports: [],
          resistances: [],
          insufficientData: true,
          dataSufficiency: {
            isFullySufficient: false,
            totalDaysCollected: 0,
            indicators: {
              volume: { collected: 0, required: 5, isReady: false },
              adAnalysis: { collected: 0, required: 10, isReady: false },
              rsi: { collected: 0, required: 14, isReady: false },
              vwap: { collected: 1, required: 1, isReady: true },
              pcr: { collected: 1, required: 1, isReady: true }
            }
          }
        });
        return;
      }
      
      const errorMap: { [key: string]: { type: string; message: string } } = { 
        TOKEN_EXPIRED: { type: 'TOKEN_EXPIRED', message: 'API token has expired. Please contact support.' }, 
        SYMBOL_NOT_FOUND: { type: 'SYMBOL_NOT_FOUND', message: `Symbol "${symbolToAnalyze}" not found.` }, 
      }; 
      const errorDetails = error instanceof Error ? errorMap[error.message] || { type: 'SERVER', message: error.message } : { type: 'UNKNOWN', message: 'Unknown error occurred' };
      setApiError(errorDetails.message); 
      addError(errorDetails.message, errorDetails.type); 
    } finally {
        setIsLoading(false);
        setLoadingState('IDLE');
    }
  }, [lastRequestTime, fetchWithRetry, addError, selectedSymbol]);

  const handleAnalyze = useCallback(() => { 
    if (isLoading) return; 
    performAnalysis(selectedSymbol); 
  }, [selectedSymbol, isLoading, performAnalysis]);

  const handleRefreshCard = useCallback(() => { 
    if (!results || refreshingCard) return;
    setRefreshingCard(true); 
    setLoadingState('REFRESHING'); 
    performAnalysis(results.symbol).finally(() => { 
      setRefreshingCard(false); 
      setLoadingState('IDLE'); 
    }); 
  }, [results, refreshingCard, performAnalysis]);

  const errorToasts = useMemo(() => 
    errors.slice(0, 3).map((error, index) => <ErrorToast key={`${error.timestamp.getTime()}-${index}`} error={error} />)
  , [errors]);

  const handleSymbolChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => { 
    setSelectedSymbol(e.target.value); 
    setApiError(''); 
    setCooldownMessage('');
  }, []);

  const { oiPcrSentiment, volumePcrSentiment } = useMemo(() => { 
    if (!results) return { oiPcrSentiment: null, volumePcrSentiment: null }; 
    return { 
      oiPcrSentiment: getAdvancedPcrSentiment(results.pcr, 'OI'), 
      volumePcrSentiment: getAdvancedPcrSentiment(results.volumePcr, 'VOLUME'), 
    }; 
  }, [results]);

  return (
    <div className="bg-brand-dark min-h-screen text-gray-300">
      <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-brand-dark via-brand-dark to-slate-900 -z-10"></div>
      {errorToasts}
      <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-12" >
        <section className="text-center py-16"  style={{ paddingTop: 0 }}>
          <h1 className="text-5xl md:text-7xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400 mb-4">Insight Engine</h1>
          <p className="text-lg md:text-xl text-gray-400 max-w-3xl mx-auto">Leverage options data to uncover market sentiment, identify key support and resistance levels, and make smarter trading decisions.</p>
        </section>

        <section className="w-full max-w-2xl mx-auto p-6 bg-brand-light-dark/50 backdrop-blur-sm rounded-xl shadow-2xl border border-white/10">
           {marketStatus !== 'UNKNOWN' && (
            <div className="flex items-center justify-center mb-4 text-sm flex-col">
              <div className="flex items-center">
                <Clock size={16} className="mr-2" />
                <span className={
                  marketStatus === 'OPEN' ? 'text-green-400' : 
                  marketStatus === 'PRE_MARKET' ? 'text-yellow-400' : 'text-red-400'
                }>
                  {marketStatus === 'PRE_MARKET' ? 'Pre-Market' : `Market is ${marketStatus.toLowerCase()}`}
                </span>
              </div>
              <p className="text-gray-400 text-xs mt-1">{marketMessage}</p>
            </div>
          )}
          <div className="relative flex items-center">
            <Briefcase className="absolute left-4 h-6 w-6 text-gray-500" />
            <select className="w-full pl-12 pr-32 py-4 bg-gray-900/50 text-white border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-cyan transition-all duration-300 appearance-none" value={selectedSymbol} onChange={handleSymbolChange} disabled={isLoading || symbolList.length === 0}>{symbolOptions}</select>
            <button 
              className="absolute right-2 bg-brand-cyan hover:bg-cyan-500 text-brand-dark font-bold py-2.5 px-6 rounded-lg transition-all duration-300 disabled:bg-gray-600 disabled:cursor-not-allowed" 
              onClick={handleAnalyze} 
              disabled={isLoading || !selectedSymbol || symbolList.length === 0}
              title="Analyze selected symbol"
            >
              {isLoading ? 'Analyzing...' : 'Analyze'}
            </button>
          </div>
          
          {cooldownMessage && (
            <div className="mt-2 p-2 bg-yellow-900/30 border border-yellow-700/50 rounded-lg text-center">
              <div className="flex items-center justify-center text-yellow-300">
                <Clock size={14} className="mr-2" />
                <span className="text-sm">{cooldownMessage}</span>
              </div>
            </div>
          )}
          
          {apiError && (<div className="mt-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-center"><div className="flex items-center justify-center text-red-300"><XCircle size={16} className="mr-2" /><span className="text-sm">{apiError}</span></div></div>)}
        </section>

        {/* ADD SPEED METER SECTION HERE */}
        <section className="w-full max-w-4xl mx-auto mt-6">
          <SpeedMeter 
            analysisData={results} 
            isLoading={isLoading && !results} 
          />
        </section>

        <section id="results" className="mt-6 w-full max-w-6xl mx-auto min-h-[100px] overflow-x-hidden">
          {isLoading && !results && (
            <div className="flex flex-col items-center justify-center p-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-cyan mb-4"></div>
              <p className="text-brand-cyan text-lg">Querying the chain, please wait...</p>
            </div>
          )}
          
          {results && (
            <div className="bg-brand-light-dark/50 backdrop-blur-sm border border-white/10 p-6 rounded-xl shadow-2xl text-left animate-fade-in">
              <div className="text-center mb-6">
                <h2 className="text-3xl font-bold text-white">Analysis for <span className="text-brand-cyan">{results.symbol}</span></h2>
                
                {results.insufficientData && (
                  <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-4 mb-4">
                    <div className="flex items-center justify-center text-yellow-300">
                      <AlertTriangle size={20} className="mr-2" />
                      <span className="font-semibold">New Stock - Data Collection In Progress</span>
                    </div>
                    <p className="text-yellow-200 text-sm mt-2 text-center">
                      {results.dataSufficiency?.totalDaysCollected || 0} days collected. 
                      Basic indicators available. Advanced analysis unlocking progressively.
                    </p>
                  </div>
                )}
                
                <p className="text-gray-400 text-sm">
                  Expiry Date: {results.expiryDate}
                </p>
                <div className="flex items-center justify-center mt-2">
                    <span className="text-white font-bold text-lg">
                    {results.priceType}: {results.ltp}
                    {typeof results.changePercent === 'number' && (
                        <span className={results.changePercent >= 0 ? 'text-green-400' : 'text-red-500'}>
                        {` (${results.changePercent > 0 ? '+' : ''}${results.changePercent.toFixed(2)}%)`}
                        </span>
                    )}
                    </span>
                    <span className="text-gray-500 ml-2 text-sm">(last refreshed {results.lastRefreshed})</span>
                    <button 
                        onClick={handleRefreshCard} 
                        disabled={refreshingCard} 
                        className="ml-2 p-1 hover:bg-gray-700 rounded-full transition-colors duration-200 disabled:opacity-50" 
                        title="Refresh data"
                    >
                    <RefreshCw size={14} className={refreshingCard ? 'animate-spin' : ''} />
                    </button>
                </div>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 w-full max-w-full">
               
               {/* Row 1 */}
              <SupportResistanceList type="Support" levels={results.supports} />
              <SupportResistanceList type="Resistance" levels={results.resistances} />
              
              {/* VWAP Analysis - LIVE data */}
              <ProgressiveDataCard 
                title="📊 VWAP Analysis"
                collected={results.dataSufficiency?.indicators.vwap.collected || 1}
                required={results.dataSufficiency?.indicators.vwap.required || 1}
                isReady={true}
                liveData={true}
              >
                <VWAPAnalysisCard vwapAnalysis={results.vwapAnalysis} />
              </ProgressiveDataCard>

                {/* Row 2 */}
                {/* PCR Values - LIVE data */}
                <ProgressiveDataCard 
                  title="📊 PCR Values"
                  collected={results.dataSufficiency?.indicators.pcr.collected || 1}
                  required={results.dataSufficiency?.indicators.pcr.required || 1}
                  isReady={true}
                  liveData={true}
                >
                  <PCRStatCard 
                    title="OI PCR Ratio" 
                    value={results.pcr} 
                    sentiment={oiPcrSentiment?.sentiment} 
                    sentimentColor={oiPcrSentiment?.color} 
                  />
                </ProgressiveDataCard>

                <ProgressiveDataCard 
                  title="📊 Volume PCR"
                  collected={results.dataSufficiency?.indicators.pcr.collected || 1}
                  required={results.dataSufficiency?.indicators.pcr.required || 1}
                  isReady={true}
                  liveData={true}
                >
                  <PCRStatCard 
                    title="Volume PCR" 
                    value={results.volumePcr} 
                    sentiment={volumePcrSentiment?.sentiment} 
                    sentimentColor={volumePcrSentiment?.color} 
                  />
                </ProgressiveDataCard>

                {/* Volume Analysis - Progressive */}
                <ProgressiveDataCard 
                  title="📊 Volume Analysis"
                  collected={results.dataSufficiency?.indicators.volume.collected || 0}
                  required={results.dataSufficiency?.indicators.volume.required || 5}
                  isReady={results.dataSufficiency?.indicators.volume.isReady || false}
                >
                  <VolumeCard 
                    avg20DayVolume={results.avg20DayVolume}
                    todayVolumePercentage={results.todayVolumePercentage}
                    estimatedTodayVolume={results.estimatedTodayVolume}
                    marketStatus={marketStatus}
                    symbol={results.symbol}
                  />
                </ProgressiveDataCard>

                {/* Row 3 */}
                {/* Max Pain - Always available */}
                <DataCard 
                  title="Max Pain" 
                  value={results.maxPain} 
                  tooltip="The strike price at which the maximum number of option buyers would lose money at expiry."
                />
                
                {/* A/D Analysis - Progressive */}
                <ProgressiveDataCard 
                  title="📊 A/D Analysis"
                  collected={results.dataSufficiency?.indicators.adAnalysis.collected || 0}
                  required={results.dataSufficiency?.indicators.adAnalysis.required || 10}
                  isReady={results.dataSufficiency?.indicators.adAnalysis.isReady || false}
                >
                  <ADLineAnalysisCard 
                    adAnalysis={results.adAnalysis}
                    marketStatus={marketStatus}
                  />
                </ProgressiveDataCard>

                {/* RSI Analysis - Progressive */}
                <ProgressiveDataCard 
                  title="📊 RSI Analysis"
                  collected={results.dataSufficiency?.indicators.rsi.collected || 0}
                  required={results.dataSufficiency?.indicators.rsi.required || 14}
                  isReady={results.dataSufficiency?.indicators.rsi.isReady || false}
                >
                  <RSIAnalysisCard rsiAnalysis={results.rsiAnalysis} />
                </ProgressiveDataCard>
              </div>
            </div>
          )}
        </section>

        <section className="w-full max-w-5xl mx-auto mt-24 text-center"  style={{ marginTop: '3rem' }}>
          <h2 className="text-3xl font-bold mb-10">Core Features</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <FeatureCard icon={<BarChart />} title="OI Analysis" description="Visualize support and resistance levels based on real-time Open Interest data with trend analysis." />
            <FeatureCard icon={<TrendingUp />} title="PCR Sentiment" description="Gauge overall market sentiment with the up-to-the-minute Put-Call Ratio." />
            <FeatureCard icon={<TrendingUp />} title="Advanced Analytics" description="Track momentum with RSI, VWAP positioning, and money flow analysis." />
          </div>
        </section>

        <section className="w-full max-w-2xl mx-auto mt-24 p-8 bg-brand-light-dark/50 backdrop-blur-sm rounded-xl shadow-2xl border border-white/10"  style={{ marginTop: '3rem' }}>
          <h2 className="text-3xl font-bold text-center mb-6">Get In Touch</h2>
          <form className="flex flex-col gap-4">
            <div className="relative"><Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"/><input type="text" placeholder="Your Name" className="w-full pl-10 p-3 bg-gray-900/50 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-cyan" /></div>
            <div className="relative"><Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"/><input type="email" placeholder="Your Email" className="w-full pl-10 p-3 bg-gray-900/50 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-cyan" /></div>
            <textarea placeholder="Your Message" rows={4} className="p-3 bg-gray-900/50 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-cyan"></textarea>
            <button type="submit" className="bg-brand-cyan hover:bg-cyan-5 text-brand-dark font-bold py-3 px-6 rounded-lg transition-all duration-300">Send Message</button>
          </form>
        </section>
      </main>
    </div>
  );
}