'use client';

import React, { useState, useEffect } from 'react';
import { Zap, TrendingUp, TrendingDown, Gauge, Info } from 'lucide-react';

interface SpeedMeterProps {
  analysisData: any;
  isLoading?: boolean;
}

export default function SpeedMeter({ analysisData, isLoading = false }: SpeedMeterProps) {
  const [currentScore, setCurrentScore] = useState(0);
  const [hasAnimated, setHasAnimated] = useState(false);
  const [isPulsing, setIsPulsing] = useState(false);

  // DIRECTLY USE THE SCORE FROM SMART SENTIMENT - NO CALCULATION
  const getScoreFromBackend = (analysisData: any) => {
    // Take the score directly from backend smart sentiment
    const score = analysisData?.sentimentScore || 0;
    const sentiment = analysisData?.sentiment || 'NEUTRAL';
    
    console.log('🔍 SpeedMeter - Direct backend data:', {
      scoreFromBackend: score,
      sentimentFromBackend: sentiment,
      hasBreakdown: !!analysisData?.sentimentBreakdown
    });
    
    return { score, sentiment };
  };

  // Score interpretation helper (display only)
  const getScoreInterpretation = (score: number): string => {
    const absScore = Math.abs(score);
    
    if (absScore >= 5) return 'Very strong market conviction';
    if (absScore >= 3) return 'Strong directional bias';
    if (absScore >= 1) return 'Moderate market sentiment';
    return 'Neutral market conditions';
  };

  // Animate meter with the actual backend score
  useEffect(() => {
    if (analysisData && !isLoading) {
      const backendData = getScoreFromBackend(analysisData);
      const actualScore = backendData.score;
      
      console.log('🔄 SpeedMeter Update - Using backend score:', actualScore);
      
      // Check for significant change to trigger pulse
      if (Math.abs(actualScore - currentScore) > 3) {
        setIsPulsing(true);
        setTimeout(() => setIsPulsing(false), 1000);
      }
      
      if (!hasAnimated) {
        animateMeter(actualScore);
        setHasAnimated(true);
      } else {
        setCurrentScore(actualScore);
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

  const getScoreColor = (score: number) => {
    if (score >= 5) return 'text-green-400';
    if (score >= 3) return 'text-green-300';
    if (score >= 1) return 'text-green-200';
    if (score <= -5) return 'text-red-500';
    if (score <= -3) return 'text-red-400';
    if (score <= -1) return 'text-red-300';
    return 'text-yellow-400';
  };

  const getSentimentIcon = (score: number) => {
    if (score >= 5) return <TrendingUp className="text-green-400" size={18} />;
    if (score >= 3) return <TrendingUp className="text-green-300" size={18} />;
    if (score >= 1) return <TrendingUp className="text-green-200" size={18} />;
    if (score <= -5) return <TrendingDown className="text-red-500" size={18} />;
    if (score <= -3) return <TrendingDown className="text-red-400" size={18} />;
    if (score <= -1) return <TrendingDown className="text-red-300" size={18} />;
    return <Gauge className="text-yellow-400" size={18} />;
  };

  const getNeedlePosition = (score: number) => {
    return 50 + (score / 10) * 50;
  };

  const getBreakdownDotColor = (line: string) => {
    if (line.includes('+')) return 'bg-green-500';
    if (line.includes('-')) return 'bg-red-500';
    return 'bg-gray-500';
  };

  const backendData = analysisData ? getScoreFromBackend(analysisData) : null;

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
    <div className={`bg-gray-900/50 p-6 rounded-lg border border-gray-700 transition-all duration-300 ${
      isPulsing ? 'animate-pulse ring-2 ring-yellow-400' : ''
    }`}>
      <div className="text-center mb-6">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Zap className="text-yellow-400" size={20} />
          <h3 className="text-lg font-bold text-white">Smart Sentiment Score</h3>
        </div>
        {/* REMOVED: The line "Direct display of backend smart sentiment analysis" */}
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
          {backendData && (
            <>
              <div className="flex items-center justify-center text-sm text-gray-300 gap-2 mb-2">
                {getSentimentIcon(currentScore)}
                <span className="capitalize">{backendData.sentiment.toLowerCase()}</span>
              </div>
              <div className="text-xs text-gray-400">
                {getScoreInterpretation(currentScore)}
              </div>
            </>
          )}
        </div>

        {/* SCORING BREAKDOWN - ALWAYS VISIBLE AT BOTTOM */}
        {analysisData.sentimentBreakdown && analysisData.sentimentBreakdown.length > 0 && (
          <div className="mt-6 p-4 bg-gray-800/30 rounded-lg border border-gray-600">
            <h4 className="text-sm font-semibold text-gray-300 mb-3 text-center">Scoring Breakdown</h4>
            <div className="space-y-2 text-xs text-gray-400">
              {analysisData.sentimentBreakdown.map((line: string, index: number) => (
                <div 
                  key={index} 
                  className={`flex items-center justify-between py-1 px-2 rounded ${
                    line.includes('---') ? 'border-t border-gray-600 my-1' : 
                    line.includes('Total:') ? 'font-bold bg-gray-700/50' : 
                    'hover:bg-gray-700/30'
                  }`}
                >
                  <div className="flex items-center">
                    <div className={`w-2 h-2 rounded-full mr-2 ${getBreakdownDotColor(line)}`}></div>
                    <span>{line}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Data Quality Indicators */}
        
      </div>
    </div>
  );
}