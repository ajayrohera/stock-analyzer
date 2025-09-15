// utils/supportResistance.ts
export interface SupportResistanceLevel {
  price: number;
  strength: 'weak' | 'medium' | 'strong';
  type: 'support' | 'resistance';
}

export interface HistoricalData {
  date: string;
  totalVolume: number;
  lastPrice?: number;
  timestamp: number;
}

// Stock-specific psychological levels
const psychologicalLevels: Record<string, number[]> = {
  'LAURUSLABS': [800, 850, 860, 900, 950, 1000],
  'RELIANCE': [2400, 2500, 2600, 2700, 2800, 2900, 3000],
  'INFY': [1400, 1500, 1600, 1700, 1800],
  'TATASTEEL': [120, 130, 140, 150, 160],
  'NIFTY': [24000, 24500, 25000, 25500, 26000],
  'BANKNIFTY': [52000, 53000, 54000, 55000, 56000],
};

export function calculateSupportResistance(
  history: HistoricalData[],
  currentPrice: number
): SupportResistanceLevel[] {
  if (!history || history.length === 0 || !currentPrice) return [];
  
  const levels: SupportResistanceLevel[] = [];
  const priceLevels = new Map<number, number>();
  
  // Analyze price levels with volume concentration
  history.forEach(entry => {
    if (entry.lastPrice) {
      const roundedPrice = Math.round(entry.lastPrice / 5) * 5; // Group nearby prices
      const volume = priceLevels.get(roundedPrice) || 0;
      priceLevels.set(roundedPrice, volume + (entry.totalVolume || 0));
    }
  });
  
  // Convert to array and sort by volume
  const sortedLevels = Array.from(priceLevels.entries())
    .sort((a, b) => b[1] - a[1]) // Sort by volume descending
    .slice(0, 10); // Top 10 levels
  
  // Classify as support or resistance
  sortedLevels.forEach(([price, volume]) => {
    const distancePercent = Math.abs((price - currentPrice) / currentPrice) * 100;
    
    // Only consider levels within 20% of current price
    if (distancePercent <= 20) {
      let strength: 'weak' | 'medium' | 'strong' = 'weak';
      
      // Determine strength based on volume percentile
      const maxVolume = Math.max(...sortedLevels.map(l => l[1]));
      const volumeRatio = volume / maxVolume;
      
      if (volumeRatio > 0.7) strength = 'strong';
      else if (volumeRatio > 0.4) strength = 'medium';
      
      levels.push({
        price,
        strength,
        type: price < currentPrice ? 'support' : 'resistance'
      });
    }
  });
  
  return levels;
}

export function calculateEnhancedSupportResistance(
  symbol: string,
  history: HistoricalData[],
  currentPrice: number
): SupportResistanceLevel[] {
  const baseLevels = calculateSupportResistance(history, currentPrice);
  
  // Add psychological levels for this specific stock
  const psychLevels = psychologicalLevels[symbol.toUpperCase()] || [];
  const stockSpecificLevels: SupportResistanceLevel[] = [];
  
  psychLevels.forEach(level => {
    const distancePercent = Math.abs(level - currentPrice) / currentPrice * 100;
    if (distancePercent <= 20) { // Within 20% of current price
      const existingLevel = baseLevels.find(l => Math.abs(l.price - level) <= 10);
      
      if (!existingLevel) {
        stockSpecificLevels.push({
          price: level,
          strength: 'medium', // Psychological levels are usually medium strength
          type: level < currentPrice ? 'support' : 'resistance'
        });
      } else {
        // Enhance existing level if it's near a psychological level
        existingLevel.strength = 'strong';
      }
    }
  });
  
  // Merge and deduplicate levels
  const allLevels = [...baseLevels, ...stockSpecificLevels];
  const uniqueLevels = allLevels.filter((level, index, array) =>
    index === array.findIndex(l => Math.abs(l.price - level.price) <= 5)
  );
  
  // Sort by proximity to current price
  return uniqueLevels
    .sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice))
    .slice(0, 5); // Return top 5 closest levels
}