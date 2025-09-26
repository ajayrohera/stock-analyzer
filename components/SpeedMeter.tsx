'use client';

import React, { useState, useEffect } from 'react';
import { Zap, TrendingUp, TrendingDown, Gauge } from 'lucide-react';

interface SpeedMeterProps {
  analysisData: any;
  isLoading?: boolean;
}

export default function SpeedMeter({ analysisData, isLoading = false }: SpeedMeterProps) {
  const [currentScore, setCurrentScore] = useState(0);
  const [hasAnimated, setHasAnimated] = useState(false);

  // Convert analysis to meter score when data changes
  useEffect(() => {
    if (analysisData && !isLoading) {
      console.log('🔍 SpeedMeter DEBUG - Analysis data received:', {
        symbol: analysisData.symbol,
        pcr: analysisData.pcr,
        volumePcr: analysisData.volumePcr,
        changePercent: analysisData.changePercent,
        supports: analysisData.supports?.length,
        resistances: analysisData.resistances?.length,
        sentiment: analysisData.sentiment
      });
      
      const meterResult = convertToSpeedScore(analysisData);
      console.log('🔍 SpeedMeter DEBUG - Calculated score:', meterResult);
      
      if (!hasAnimated) {
        animateMeter(meterResult.score);
        setHasAnimated(true);
      } else {
        setCurrentScore(meterResult.score);
      }
    } else if (!analysisData) {
      setCurrentScore(0);
      setHasAnimated(false);
    }
  }, [analysisData, isLoading, hasAnimated]);

  const animateMeter = async (targetScore: number) => {
    const duration = 1500;
    const steps = 50;
    const stepDuration = duration / steps;
    
    setCurrentScore(0);
    await new Promise(resolve => setTimeout(resolve, 100));
    
    for (let i = 0; i <= steps; i++) {
      const progress = i / steps;
      const easeProgress = 1 - Math.pow(1 - progress, 3);
      const current = targetScore * easeProgress;
      setCurrentScore(Number(current.toFixed(1)));
      await new Promise(resolve => setTimeout(resolve, stepDuration));
    }
  };

  const convertToSpeedScore = (analysisData: any) => {
    if (!analysisData) return { score: 0, sentiment: 'NEUTRAL', confidence: 0 };
    
    let score = 0;
    console.log('🔍 Starting score calculation for:', analysisData.symbol);
    
    // PCR scoring (-3 to +3)
    const pcr = analysisData.pcr || 1;
    console.log('🔍 PCR:', pcr, 'Score contribution:', 
      pcr > 1.3 ? '+3' : pcr > 1.1 ? '+2' : pcr > 0.9 ? '0' : pcr > 0.7 ? '-2' : '-3');
    
    if (pcr > 1.3) score += 3;
    else if (pcr > 1.1) score += 2;
    else if (pcr > 0.9) score += 0;
    else if (pcr > 0.7) score -= 2;
    else score -= 3;

    // Volume PCR scoring (-2 to +2)
    const volumePcr = analysisData.volumePcr || 1;
    console.log('🔍 Volume PCR:', volumePcr, 'Score contribution:',
      volumePcr < 0.7 ? '+2' : volumePcr < 0.9 ? '+1' : volumePcr > 1.3 ? '-2' : volumePcr > 1.1 ? '-1' : '0');
    
    if (volumePcr < 0.7) score += 2;
    else if (volumePcr < 0.9) score += 1;
    else if (volumePcr > 1.3) score -= 2;
    else if (volumePcr > 1.1) score -= 1;

    // Price change scoring (-2 to +2)
    const changePercent = analysisData.changePercent || 0;
    console.log('🔍 Change %:', changePercent, 'Score contribution:',
      changePercent > 2 ? '+2' : changePercent > 0.5 ? '+1' : changePercent < -2 ? '-2' : changePercent < -0.5 ? '-1' : '0');
    
    if (changePercent > 2) score += 2;
    else if (changePercent > 0.5) score += 1;
    else if (changePercent < -2) score -= 2;
    else if (changePercent < -0.5) score -= 1;

    // FIXED: Support/Resistance scoring (-3 to +3)
    const supports = analysisData.supports || [];
    const resistances = analysisData.resistances || [];
    
    console.log('🔍 Supports details:', supports);
    console.log('🔍 Resistances details:', resistances);
    
    // Calculate strength based on actual support/resistance objects
    const supportStrength = supports.reduce((sum: number, s: any) => {
      const strengthValue = s.strength === 'strong' ? 2 : s.strength === 'medium' ? 1 : 0.5;
      console.log(`🔍 Support ${s.price}: ${s.strength} = ${strengthValue} points`);
      return sum + strengthValue;
    }, 0);
    
    const resistanceStrength = resistances.reduce((sum: number, r: any) => {
      const strengthValue = r.strength === 'strong' ? 2 : r.strength === 'medium' ? 1 : 0.5;
      console.log(`🔍 Resistance ${r.price}: ${r.strength} = ${strengthValue} points`);
      return sum + strengthValue;
    }, 0);
    
    const optionsBias = supportStrength - resistanceStrength;
    
    console.log('🔍 Options Bias Calculation:');
    console.log('🔍 Total Support Strength:', supportStrength);
    console.log('🔍 Total Resistance Strength:', resistanceStrength);
    console.log('🔍 Options Bias:', optionsBias);
    console.log('🔍 Options Bias Score contribution:',
      optionsBias > 2 ? '+3' : optionsBias > 1 ? '+2' : optionsBias < -2 ? '-3' : optionsBias < -1 ? '-2' : '0');
    
    if (optionsBias > 2) score += 3;
    else if (optionsBias > 1) score += 2;
    else if (optionsBias < -2) score -= 3;
    else if (optionsBias < -1) score -= 2;

    // Clamp between -10 and 10
    score = Math.max(-10, Math.min(10, score));

    // FIXED: Better sentiment classification thresholds
    let sentiment = 'NEUTRAL';
    if (score >= 6) sentiment = 'STRONGLY_BULLISH';
    else if (score >= 3) sentiment = 'BULLISH';
    else if (score >= 1) sentiment = 'SLIGHTLY_BULLISH';
    else if (score <= -6) sentiment = 'STRONGLY_BEARISH';
    else if (score <= -3) sentiment = 'BEARISH';
    else if (score <= -1) sentiment = 'SLIGHTLY_BEARISH';

    const hasGoodData = analysisData.supports?.length > 0 && analysisData.resistances?.length > 0;
    const confidence = hasGoodData ? 85 : 65;

    console.log('🔍 Final score:', score, 'Sentiment:', sentiment, 'Confidence:', confidence);
    
    return { score, sentiment, confidence };
  };

  const getScoreColor = (score: number) => {
    if (score >= 6) return 'text-green-400';
    if (score >= 3) return 'text-green-300';
    if (score >= 1) return 'text-green-200';
    if (score <= -6) return 'text-red-500';
    if (score <= -3) return 'text-red-400';
    if (score <= -1) return 'text-red-300';
    return 'text-yellow-400';
  };

  const getSentimentIcon = (sentiment: string) => {
    switch (sentiment) {
      case 'STRONGLY_BULLISH': return <TrendingUp className="text-green-400" size={18} />;
      case 'BULLISH': return <TrendingUp className="text-green-300" size={18} />;
      case 'SLIGHTLY_BULLISH': return <TrendingUp className="text-green-200" size={18} />;
      case 'STRONGLY_BEARISH': return <TrendingDown className="text-red-500" size={18} />;
      case 'BEARISH': return <TrendingDown className="text-red-400" size={18} />;
      case 'SLIGHTLY_BEARISH': return <TrendingDown className="text-red-300" size={18} />;
      default: return <Gauge className="text-yellow-400" size={18} />;
    }
  };

  const getNeedlePosition = (score: number) => {
    return 50 + (score / 10) * 50;
  };

  const result = analysisData ? convertToSpeedScore(analysisData) : null;

  if (isLoading) {
    return (
      <div className="bg-gray-900/50 p-6 rounded-lg text-center border border-gray-700">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-cyan mx-auto mb-4"></div>
        <p className="text-gray-400">Calculating sentiment...</p>
      </div>
    );
  }

  if (!analysisData) {
    return (
      <div className="bg-gray-900/50 p-6 rounded-lg text-center border border-gray-700">
        <Zap className="mx-auto mb-3 text-gray-500" size={24} />
        <p className="text-gray-400">Analyze a symbol to see sentiment score</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900/50 p-6 rounded-lg border border-gray-700">
      <div className="text-center mb-6">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Zap className="text-yellow-400" size={20} />
          <h3 className="text-lg font-bold text-white">Smart Sentiment Score</h3>
        </div>
        <p className="text-gray-400 text-sm">
          Combined analysis of PCR, volume, price momentum, and options data
        </p>
      </div>

      <div className="relative max-w-2xl mx-auto">
        <div className="flex justify-between text-gray-400 text-xs mb-2 px-2">
          <span>-10</span>
          <span>Bearish</span>
          <span>0</span>
          <span>Bullish</span>
          <span>+10</span>
        </div>
        
        <div className="h-6 bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 rounded-full overflow-hidden relative mb-8">
          <div 
            className="absolute top-0 bottom-0 w-1 bg-white z-10 transition-all duration-200 ease-out shadow-lg"
            style={{ 
              left: `${getNeedlePosition(currentScore)}%`,
            }}
          >
            <div className="absolute -top-1 left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-3 border-r-3 border-b-3 border-b-white border-l-transparent border-r-transparent"></div>
          </div>
        </div>

        <div className="text-center mt-4">
          <div className={`text-4xl font-bold ${getScoreColor(currentScore)} mb-3`}>
            {currentScore > 0 ? '+' : ''}{currentScore.toFixed(1)}
          </div>
          {result && (
            <div className="flex items-center justify-center text-sm text-gray-300 gap-2">
              {getSentimentIcon(result.sentiment)}
              <span className="capitalize">{result.sentiment.toLowerCase().replace('_', ' ')}</span>
              <span>•</span>
              <span>{result.confidence}% confidence</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}