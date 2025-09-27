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
  const [showBreakdown, setShowBreakdown] = useState(false);

  // Convert backend sentiment to score (EXACT same mapping as Smart Sentiment Card)
  const convertSentimentToScore = (analysisData: any) => {
    const sentiment = analysisData.sentiment || 'NEUTRAL';
    console.log('🔍 SpeedMeter DEBUG - Raw sentiment from backend:', sentiment);
    
    // EXACT same mapping as used in Smart Sentiment Card
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

    // Simple confidence calculation based on data availability
    const confidence = analysisData.supports?.length > 0 && 
                      analysisData.resistances?.length > 0 && 
                      analysisData.pcr !== undefined ? 85 : 65;

    console.log('🔍 SpeedMeter DEBUG - Final score:', { score, sentiment: displaySentiment, confidence });
    
    return { score, sentiment: displaySentiment, confidence };
  };

  // Score interpretation helper
  const getScoreInterpretation = (score: number): string => {
    const absScore = Math.abs(score);
    
    if (absScore >= 7) return 'Very strong market conviction';
    if (absScore >= 4) return 'Strong directional bias';
    if (absScore >= 2) return 'Moderate market sentiment';
    if (absScore >= 1) return 'Weak directional signal';
    
    return 'Neutral market conditions';
  };

  // Convert sentiment to score and animate
  useEffect(() => {
    if (analysisData && !isLoading) {
      const meterResult = convertSentimentToScore(analysisData);
      
      // Check for significant change to trigger pulse
      if (Math.abs(meterResult.score - currentScore) > 3) {
        setIsPulsing(true);
        setTimeout(() => setIsPulsing(false), 1000);
      }
      
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

  const result = analysisData ? convertSentimentToScore(analysisData) : null;

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
          <button 
            onClick={() => setShowBreakdown(!showBreakdown)}
            className="text-gray-400 hover:text-gray-300 transition-colors"
            title="Show breakdown"
          >
            <Info size={16} />
          </button>
        </div>
        <p className="text-gray-400 text-sm">
          Visual representation of smart sentiment analysis
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
            <>
              <div className="flex items-center justify-center text-sm text-gray-300 gap-2 mb-2">
                {getSentimentIcon(result.sentiment)}
                <span className="capitalize">{result.sentiment.toLowerCase().replace('_', ' ')}</span>
                <span>•</span>
                <span>{result.confidence}% confidence</span>
              </div>
              <div className="text-xs text-gray-400">
                {getScoreInterpretation(currentScore)}
              </div>
            </>
          )}
        </div>

        {/* Simple Breakdown */}
        {showBreakdown && result && (
          <div className="mt-6 p-4 bg-gray-800/50 rounded-lg border border-gray-700">
            <h4 className="text-sm font-semibold text-gray-300 mb-3">Sentiment Source</h4>
            <div className="space-y-2 text-xs text-gray-400">
              <div className="flex justify-between">
                <span>Backend Sentiment:</span>
                <span className="capitalize">{result.sentiment.toLowerCase().replace('_', ' ')}</span>
              </div>
              <div className="flex justify-between">
                <span>Mapped Score:</span>
                <span className={getScoreColor(result.score)}>
                  {result.score > 0 ? '+' : ''}{result.score}
                </span>
              </div>
              <div className="flex justify-between">
                <span>PCR:</span>
                <span>{analysisData.pcr?.toFixed(2) || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span>Volume PCR:</span>
                <span>{analysisData.volumePcr?.toFixed(2) || 'N/A'}</span>
              </div>
            </div>
          </div>
        )}

        {/* Data Quality Indicators */}
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-gray-500">
          <div className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${
              analysisData.supports?.length > 0 ? 'bg-green-400' : 'bg-gray-500'
            }`} />
            <span>Supports: {analysisData.supports?.length || 0}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${
              analysisData.resistances?.length > 0 ? 'bg-green-400' : 'bg-gray-500'
            }`} />
            <span>Resistances: {analysisData.resistances?.length || 0}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${
              analysisData.pcr !== undefined ? 'bg-green-400' : 'bg-gray-500'
            }`} />
            <span>PCR: {analysisData.pcr !== undefined ? '✓' : '✗'}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${
              analysisData.volumePcr !== undefined ? 'bg-green-400' : 'bg-gray-500'
            }`} />
            <span>Vol. PCR: {analysisData.volumePcr !== undefined ? '✓' : '✗'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}