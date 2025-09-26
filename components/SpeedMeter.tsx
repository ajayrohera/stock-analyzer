'use client';

import React, { useState, useEffect } from 'react';
import { Zap, TrendingUp, TrendingDown, Gauge } from 'lucide-react';

interface SpeedMeterProps {
  analysisData: any; // Your existing analysis result
  isLoading?: boolean;
}

export default function SpeedMeter({ analysisData, isLoading = false }: SpeedMeterProps) {
  const [currentScore, setCurrentScore] = useState(0);
  const [hasAnimated, setHasAnimated] = useState(false);

  // Convert analysis to meter score when data changes
  useEffect(() => {
    if (analysisData && !isLoading) {
      const meterResult = convertToSpeedScore(analysisData);
      
      if (!hasAnimated) {
        animateMeter(meterResult.score);
        setHasAnimated(true);
      } else {
        // If already animated, just set the score directly
        setCurrentScore(meterResult.score);
      }
    } else if (!analysisData) {
      // Reset when no data
      setCurrentScore(0);
      setHasAnimated(false);
    }
  }, [analysisData, isLoading, hasAnimated]);

  const animateMeter = async (targetScore: number) => {
    const duration = 1500; // 1.5 second animation
    const steps = 50;
    const stepDuration = duration / steps;
    
    // Reset to 0 first
    setCurrentScore(0);
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Animate to target score
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
    
    // PCR scoring (-3 to +3)
    const pcr = analysisData.pcr || 1;
    if (pcr > 1.3) score += 3;
    else if (pcr > 1.1) score += 2;
    else if (pcr > 0.9) score += 0;
    else if (pcr > 0.7) score -= 2;
    else score -= 3;

    // Volume PCR scoring (-2 to +2)
    const volumePcr = analysisData.volumePcr || 1;
    if (volumePcr < 0.7) score += 2;
    else if (volumePcr < 0.9) score += 1;
    else if (volumePcr > 1.3) score -= 2;
    else if (volumePcr > 1.1) score -= 1;

    // Price change scoring (-2 to +2)
    const changePercent = analysisData.changePercent || 0;
    if (changePercent > 2) score += 2;
    else if (changePercent > 0.5) score += 1;
    else if (changePercent < -2) score -= 2;
    else if (changePercent < -0.5) score -= 1;

    // Support/Resistance scoring (-3 to +3)
    const supports = analysisData.supports || [];
    const resistances = analysisData.resistances || [];
    
    const supportStrength = supports.reduce((sum: number, s: any) => 
      sum + (s.strength === 'strong' ? 2 : s.strength === 'medium' ? 1 : 0.5), 0);
    const resistanceStrength = resistances.reduce((sum: number, r: any) => 
      sum + (r.strength === 'strong' ? 2 : r.strength === 'medium' ? 1 : 0.5), 0);
    const optionsBias = supportStrength - resistanceStrength;
    
    if (optionsBias > 2) score += 3;
    else if (optionsBias > 1) score += 2;
    else if (optionsBias < -2) score -= 3;
    else if (optionsBias < -1) score -= 2;

    // Clamp between -10 and 10
    score = Math.max(-10, Math.min(10, score));

    // Determine sentiment
    let sentiment = 'NEUTRAL';
    if (score >= 6) sentiment = 'STRONGLY_BULLISH';
    else if (score >= 2) sentiment = 'BULLISH';
    else if (score <= -6) sentiment = 'STRONGLY_BEARISH';
    else if (score <= -2) sentiment = 'BEARISH';

    // Calculate confidence
    const hasGoodData = analysisData.supports?.length > 0 && analysisData.resistances?.length > 0;
    const confidence = hasGoodData ? 85 : 65;

    return { score, sentiment, confidence };
  };

  const getScoreColor = (score: number) => {
    if (score >= 6) return 'text-green-400';
    if (score >= 2) return 'text-green-300';
    if (score <= -6) return 'text-red-500';
    if (score <= -2) return 'text-red-400';
    return 'text-yellow-400';
  };

  const getSentimentIcon = (sentiment: string) => {
    switch (sentiment) {
      case 'STRONGLY_BULLISH': return <TrendingUp className="text-green-400" size={18} />;
      case 'BULLISH': return <TrendingUp className="text-green-300" size={18} />;
      case 'STRONGLY_BEARISH': return <TrendingDown className="text-red-500" size={18} />;
      case 'BEARISH': return <TrendingDown className="text-red-400" size={18} />;
      default: return <Gauge className="text-yellow-400" size={18} />;
    }
  };

  // Calculate needle position (0% to 100% where 50% is center/neutral)
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

      {/* Meter Container */}
      <div className="relative max-w-2xl mx-auto">
        {/* Meter Scale */}
        <div className="flex justify-between text-gray-400 text-xs mb-2 px-2">
          <span>-10</span>
          <span>Bearish</span>
          <span>0</span>
          <span>Bullish</span>
          <span>+10</span>
        </div>
        
        {/* Meter Track */}
        <div className="h-6 bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 rounded-full overflow-hidden relative mb-8">
          {/* Animated Needle */}
          <div 
            className="absolute top-0 bottom-0 w-1 bg-white z-10 transition-all duration-200 ease-out shadow-lg"
            style={{ 
              left: `${getNeedlePosition(currentScore)}%`,
            }}
          >
            <div className="absolute -top-1 left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-3 border-r-3 border-b-3 border-b-white border-l-transparent border-r-transparent"></div>
          </div>
        </div>

        {/* Current Score Display */}
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