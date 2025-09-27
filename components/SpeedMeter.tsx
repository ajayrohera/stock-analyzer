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

  // Convert existing sentiment to meter score
  useEffect(() => {
    if (analysisData && !isLoading) {
      console.log('🔍 SpeedMeter DEBUG - Using existing sentiment:', analysisData.sentiment);
      
      const meterResult = convertSentimentToScore(analysisData.sentiment);
      console.log('🔍 SpeedMeter DEBUG - Converted score:', meterResult);
      
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

  const convertSentimentToScore = (sentiment: string) => {
    console.log('🔍 Converting sentiment to score:', sentiment);
    
    // Map existing sentiment to scores
    let score = 0;
    let displaySentiment = 'NEUTRAL';
    
    switch(sentiment?.toUpperCase()) {
      case 'STRONGLY BULLISH':
      case 'STRONGLY_BULLISH':
        score = 8;
        displaySentiment = 'STRONGLY_BULLISH';
        break;
      case 'BULLISH':
        score = 5;
        displaySentiment = 'BULLISH';
        break;
      case 'SLIGHTLY BULLISH':
      case 'SLIGHTLY_BULLISH':
        score = 2;
        displaySentiment = 'SLIGHTLY_BULLISH';
        break;
      case 'NEUTRAL':
        score = 0;
        displaySentiment = 'NEUTRAL';
        break;
      case 'SLIGHTLY BEARISH':
      case 'SLIGHTLY_BEARISH':
        score = -2;
        displaySentiment = 'SLIGHTLY_BEARISH';
        break;
      case 'BEARISH':
        score = -5;
        displaySentiment = 'BEARISH';
        break;
      case 'STRONGLY BEARISH':
      case 'STRONGLY_BEARISH':
        score = -8;
        displaySentiment = 'STRONGLY_BEARISH';
        break;
      default:
        score = 0;
        displaySentiment = 'NEUTRAL';
    }

    console.log('🔍 Final conversion:', { sentiment, score, displaySentiment });
    
    return { score, sentiment: displaySentiment, confidence: 85 };
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

  const result = analysisData ? convertSentimentToScore(analysisData.sentiment) : null;

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
          Visual representation of the smart sentiment analysis
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
              <span>85% confidence</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}