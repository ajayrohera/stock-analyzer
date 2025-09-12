const SupportResistanceCard = React.memo(({ type, value, strength }: { type: 'Support' | 'Resistance', value: number, strength: string }) => { 
  const isSupport = type === 'Support'; 
  const color = isSupport ? 'text-green-400' : 'text-red-500'; 
  let strengthColor = 'text-gray-400'; 
  if (strength === 'Very Strong') strengthColor = 'text-cyan-400'; 
  if (strength === 'Strong') strengthColor = 'text-white'; 
  return ( 
    <div className="bg-gray-900/50 p-4 rounded-lg text-center h-full flex flex-col justify-center">
      <p className="text-sm text-gray-400">{isSupport ? 'Key Support' : 'Key Resistance'}</p>
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
      <p className={`text-xs font-bold uppercase ${strengthColor}`}>{strength}</p>
    </div> 
  ); 
});
SupportResistanceCard.displayName = 'SupportResistanceCard';

const SentimentCard = React.memo(({ sentiment }: { sentiment: string }) => { 
  const isBullish = sentiment.includes('Bullish'); 
  const isBearish = sentiment.includes('Bearish'); 
  let color = 'text-white'; 
  if (isBullish) color = 'text-green-400'; 
  if (isBearish) color = 'text-red-500'; 
  return ( 
    <div className="bg-gray-900/50 p-4 rounded-lg text-center h-full flex flex-col justify-center">
      <div className="flex items-center justify-center text-sm text-gray-400">
        <span>SMART Sentiment</span>
        <div className="relative group ml-1">
          <Info size={14} className="cursor-pointer" />
          <div className="absolute bottom-full mb-2 w-64 p-2 text-xs text-left text-white bg-gray-900 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
            This is a sophisticated sentiment analysis based on the Put-Call Ratio and the concentration of Open Interest at key Out-of-the-Money (OTM) strike prices.
          </div>
        </div>
      </div>
      <div className={`flex items-center justify-center text-2xl font-bold ${color}`}>
        {isBullish && <CheckCircle2 size={24} className="mr-2" />}
        {isBearish && <XCircle size={24} className="mr-2" />}
        <span>{sentiment}</span>
      </div>
    </div> 
  ); 
});
SentimentCard.displayName = 'SentimentCard';

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

// VolumeCard component with pre-market support
const VolumeCard = React.memo(({ 
  avg20DayVolume, 
  todayVolumePercentage, 
  estimatedTodayVolume,
  marketStatus
}: { 
  avg20DayVolume?: number;
  todayVolumePercentage?: number;
  estimatedTodayVolume?: number;
  marketStatus: MarketStatus;
}) => {
  const formatVolume = (volume: number) => {
    if (volume >= 1000000) return `${(volume / 1000000).toFixed(1)}M`;
    if (volume >= 1000) return `${(volume / 1000).toFixed(1)}K`;
    return volume.toString();
  };

  const getPercentageColor = (percentage: number) => {
    if (percentage > 100) return 'text-green-400';
    if (percentage > 75) return 'text-yellow-400';
    if (percentage > 50) return 'text-orange-400';
    return 'text-red-400';
  };

  if (marketStatus === 'PRE_MARKET') {
    return (
      <div className="bg-gray-900/50 p-4 rounded-lg text-center h-full flex flex-col justify-center">
        <div className="flex items-center justify-center text-sm text-gray-400">
          <span>Volume Analysis</span>
        </div>
        <p className="text-yellow-400 text-sm mt-2">Pre-market: Data from previous close</p>
        {avg20DayVolume !== undefined && (
          <p className="text-lg font-semibold text-white mt-2">
            20D Avg: {formatVolume(avg20DayVolume)}
          </p>
        )}
      </div>
    );
  }

  if (marketStatus !== 'OPEN') {
    return (
      <div className="bg-gray-900/50 p-4 rounded-lg text-center h-full flex flex-col justify-center">
        <div className="flex items-center justify-center text-sm text-gray-400">
          <span>Volume Analysis</span>
        </div>
        <p className="text-gray-400 text-sm mt-2">Data available during market hours only</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900/50 p-4 rounded-lg text-center h-full flex flex-col justify-center">
      <div className="flex items-center justify-center text-sm text-gray-400">
        <span>Volume Analysis</span>
        <div className="relative group ml-1">
          <Info size={14} className="cursor-pointer" />
          <div className="absolute bottom-full mb-2 w-64 p-2 text-xs text-left text-white bg-gray-900 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
            Compares today&apos;s volume against 20-day average. Percentage shows progress vs daily average. Estimated projects full day volume.
          </div>
        </div>
      </div>
      
      {avg20DayVolume !== undefined && (
        <p className="text-lg font-semibold text-white mt-2">
          20D Avg: {formatVolume(avg20DayVolume)}
        </p>
      )}
      
      {todayVolumePercentage !== undefined && (
        <p className={`text-xl font-bold ${getPercentageColor(todayVolumePercentage)} mt-2`}>
          {todayVolumePercentage.toFixed(1)}% of Avg
        </p>
      )}
      
      {estimatedTodayVolume !== undefined && (
        <p className="text-md text-gray-300 mt-2">
          Est. Today: {formatVolume(estimatedTodayVolume)}
        </p>
      )}
      
      {(!avg20DayVolume && !todayVolumePercentage && !estimatedTodayVolume) && (
        <p className="text-gray-400 text-sm mt-2">Volume data not available</p>
      )}
    </div>
  );
});
VolumeCard.displayName = 'VolumeCard';

// MarketHoursOnlyCard component with pre-market support
const MarketHoursOnlyCard = React.memo(({ title, marketStatus }: { title: string, marketStatus: MarketStatus }) => (
  <div className="bg-gray-900/50 p-4 rounded-lg text-center h-full flex flex-col justify-center">
    <div className="flex items-center justify-center text-sm text-gray-400">
      <span>{title}</span>
    </div>
    {marketStatus === 'PRE_MARKET' ? (
      <p className="text-yellow-400 text-sm mt-2">Pre-market: Data from previous close</p>
    ) : (
      <p className="text-gray-400 text-sm mt-2">Data available during market hours only</p>
    )}
  </div>
));
MarketHoursOnlyCard.displayName = 'MarketHoursOnlyCard';

// NEW: OIChangeRow component for displaying individual strike changes
const OIChangeRow = React.memo(({ strike, changeOi, totalOi, type }: OiChange) => {
  const isCall = type === 'CALL';
  const isPositive = changeOi > 0;
  
  return (
    <div className="flex justify-between items-center py-2 border-b border-gray-700 last:border-b-0">
      <div className="flex items-center">
        <span className={`w-16 font-mongo ${isCall ? 'text-green-400' : 'text-red-400'}`}>
          {strike}
        </span>
        <span className={`flex items-center ml-2 ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
          {isPositive ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
          <span className="ml-1">{Math.abs(changeOi).toLocaleString()}</span>
        </span>
      </div>
      <span className="text-gray-400 text-sm">{totalOi.toLocaleString()}</span>
    </div>
  );
});
OIChangeRow.displayName = 'OIChangeRow';

// NEW: OIAnalysisCard component with pre-market support
const OIAnalysisCard = React.memo(({ oiAnalysis, marketStatus }: { 
  oiAnalysis?: AnalysisResult['oiAnalysis'];
  marketStatus: MarketStatus; 
}) => {
  if (marketStatus === 'PRE_MARKET') {
    return (
      <div className="bg-gray-900/50 p-4 rounded-lg col-span-2">
        <div className="flex items-center justify-center text-sm text-gray-400 mb-4">
          <span>Open Interest Analysis</span>
          <div className="relative group ml-1">
            <Info size={14} className="cursor-pointer" />
            <div className="absolute bottom-full mb-2 w-80 p-2 text-xs text-left text-white bg-gray-900 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
              Shows the largest changes in Open Interest at key strike prices. Call OI increase suggests bullish bets, Put OI increase suggests hedging or bearish positioning.
            </div>
          </div>
        </div>
        <p className="text-yellow-400 text-sm text-center">Pre-market: OI data from previous close</p>
      </div>
    );
  }

  if (marketStatus !== 'OPEN') {
    return (
      <div className="bg-gray-900/50 p-4 rounded-lg col-span-2">
        <div className="flex items-center justify-center text-sm text-gray-400 mb-2">
          <span>Open Interest Analysis</span>
        </div>
        <p className="text-gray-400 text-sm text-center">Data available during market hours only</p>
      </div>
    );
  }

  // Handle missing oiAnalysis
  if (!oiAnalysis) {
    return (
      <div className="bg-gray-900/50 p-4 rounded-lg col-span-2">
        <div className="flex items-center justify-center text-sm text-gray-400 mb-4">
          <span>Open Interest Analysis</span>
          <div className="relative group ml-1">
            <Info size={14} className="cursor-pointer" />
            <div className="absolute bottom-full mb-2 w-80 p-2 text-xs text-left text-white bg-gray-900 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
              Shows the largest changes in Open Interest at key strike prices. Call OI increase suggests bullish bets, Put OI increase suggests hedging or bearish positioning.
            </div>
          </div>
        </div>
        <p className="text-gray-400 text-sm text-center">Open Interest data not available</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900/50 p-4 rounded-lg col-span-2">
      <div className="flex items-center justify-center text-sm text-gray-400 mb-4">
        <span>Open Interest Analysis</span>
        <div className="relative group ml-1">
          <Info size={14} className="cursor-pointer" />
          <div className="absolute bottom-full mb-2 w-80 p-2 text-xs text-left text-white bg-gray-900 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
            Shows the largest changes in Open Interest at key strike prices. Call OI increase suggests bullish bets, Put OI increase suggests hedging or bearish positioning.
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <h4 className="text-green-400 font-semibold mb-2 text-center">Call OI Changes</h4>
          <div className="max-h-40 overflow-y-auto">
            {oiAnalysis.calls.length > 0 ? (
              oiAnalysis.calls.map((item, index) => (
                <OIChangeRow key={`call-${index}`} {...item} />
              ))
            ) : (
              <p className="text-gray-400 text-sm text-center py-2">No significant call OI changes</p>
            )}
          </div>
        </div>
        
        <div>
          <h4 className="text-red-400 font-semibold mb-2 text-center">Put OI Changes</h4>
          <div className="max-h-40 overflow-y-auto">
            {oiAnalysis.puts.length > 0 ? (
              oiAnalysis.puts.map((item, index) => (
                <OIChangeRow key={`put-${index}`} {...item} />
              ))
            ) : (
              <p className="text-gray-400 text-sm text-center py-2">No significant put OI changes</p>
            )}
          </div>
        </div>
      </div>
      
      {oiAnalysis.summary && (
        <div className="mt-4 p-3 bg-gray-800/50 rounded-lg">
          <p className="text-sm text-gray-300">{oiAnalysis.summary}</p>
        </div>
      )}
    </div>
  );
});
OIAnalysisCard.displayName = 'OIAnalysisCard';

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
  const [isCooldown, setIsCooldown] = useState(false);
  const [apiError, setApiError] = useState('');

  useEffect(() => { 
    const savedSymbol = localStorage.getItem('selectedSymbol'); 
    if (savedSymbol) setSelectedSymbol(savedSymbol); 
  }, []);

  useEffect(() => { 
    if (selectedSymbol) localStorage.setItem('selectedSymbol', selectedSymbol); 
  }, [selectedSymbol]);
  
  const addError = useCallback((message: string, type: AppError['type'] = 'UNKNOWN') => { 
    console.error(`Error [${type}]:`, message); 
    setErrors(prev => [{ message, type, timestamp: new Date() }, ...prev]); 
  }, []);

  useEffect(() => { 
    if (errors.length > 0) { 
      const timer = setTimeout(() => setErrors(prev => prev.slice(0, prev.length - 1)), 5000); 
      return () => clearTimeout(timer); 
    } 
  }, [errors]);
  
  useEffect(() => { 
    if (lastRequestTime > 0) { 
      setIsCooldown(true); 
      const timer = setTimeout(() => setIsCooldown(false), 10000); // Increased to 10 seconds
      return () => clearTimeout(timer); 
    } 
  }, [lastRequestTime]);

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
      const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000)); 
      const todayKey = `${istTime.getUTCFullYear()}-${String(istTime.getUTCMonth() + 1).padStart(2, '0')}-${String(istTime.getUTCDate()).padStart(2, '0')}`; 
      
      // Check for holidays first
      if (marketHolidays2025.has(todayKey)) { 
        setMarketStatus('CLOSED'); 
        setMarketMessage(`Market closed for ${marketHolidaysWithNames[todayKey]}. Opens ${getNextWorkingDay(istTime)} at 9:15 AM`); 
        return; 
      } 
      
      const day = istTime.getUTCDay(); 
      // Check for weekends
      if (day === 0 || day === 6) { 
        setMarketStatus('CLOSED'); 
        setMarketMessage(`Market closed for weekend. Opens Monday at 9:15 AM`); 
        return; 
      } 
      
      const timeInMinutes = istTime.getUTCHours() * 60 + istTime.getUTCMinutes(); 
      
      // Pre-market (9:00 AM to 9:15 AM)
      if (timeInMinutes >= 540 && timeInMinutes < 555) {
        setMarketStatus('PRE_MARKET');
        setMarketMessage('Pre-market hours: Data from previous close. Live data available at 9:15 AM');
      }
      // Market hours (9:15 AM to 3:30 PM)
      else if (timeInMinutes >= 555 && timeInMinutes <= 930) {
        setMarketStatus('OPEN');
        setMarketMessage('Market is open');
      }
      // Closed
      else {
        setMarketStatus('CLOSED');
        setMarketMessage(`Market closed. Showing data from last trading session. Opens ${getNextMarketOpenTime(now)}`);
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
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        addError(errorMessage === 'TOKEN_EXPIRED' ? 'API token has expired. Please contact support.' : errorMessage || "Could not load symbol list.", errorMessage === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'NETWORK'); 
      } finally { 
        setLoadingState('IDLE'); 
      } 
    };

    checkMarketStatus(); 
    fetchSymbols(); 
    const interval = setInterval(checkMarketStatus, 60000); 
    return () => clearInterval(interval);
  }, [fetchWithRetry, addError, getNextMarketOpenTime, selectedSymbol]);

  const performAnalysis = useCallback(async (symbolToAnalyze: string) => { 
    if (isCooldown) { 
      addError('Please wait 10 seconds before making another request.', 'VALIDATION'); // Updated message
      return; 
    } 
    if (!symbolToAnalyze) return; 
    setApiError(''); 
    try { 
      const response = await fetchWithRetry('/api/analyze', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ symbol: symbolToAnalyze }), 
      }); 
      const data = await response.json(); 
      
      // DEBUG LOGGING
      console.log('🔍 API Response from /api/analyze:', data);
      console.log('✅ Is valid result:', isAnalysisResult(data));
      if (!isAnalysisResult(data)) {
        console.log('❌ Validation failed. Data structure:', JSON.stringify(data, null, 2));
        throw new Error('Invalid response format from server.');
      }
      
      setResults(data); 
      setLastRequestTime(Date.now()); 
    } catch (error) { 
      const errorMap: { [key: string]: { type: AppError['type']; message: string } } = { 
        TOKEN_EXPIRED: { type: 'TOKEN_EXPIRED', message: 'API token has expired. Please contact support.' }, 
        SYMBOL_NOT_FOUND: { type: 'SYMBOL_NOT_FOUND', message: `Symbol "${symbolToAnalyze}" not found.` }, 
      }; 
      const errorDetails = error instanceof Error ? errorMap[error.message] || { type: 'SERVER' as const, message: error.message } : { type: 'UNKNOWN' as const, message: 'Unknown error occurred' };
      setApiError(errorDetails.message); 
      addError(errorDetails.message, errorDetails.type); 
    } 
  }, [isCooldown, fetchWithRetry, addError]);

  const handleAnalyze = useCallback(() => { 
    if (isLoading) return; 
    setIsLoading(true); 
    setLoadingState('ANALYZING'); 
    setResults(null); 
    performAnalysis(selectedSymbol).finally(() => { 
      setIsLoading(false); 
      setLoadingState('IDLE'); 
    }); 
  }, [selectedSymbol, isLoading, performAnalysis]);

  const handleRefreshCard = useCallback(() => { 
    if (!results || refreshingCard || isCooldown) return; // Added isCooldown check
    setRefreshingCard(true); 
    setLoadingState('REFRESHING'); 
    performAnalysis(results.symbol).finally(() => { 
      setRefreshingCard(false); 
      setLoadingState('IDLE'); 
    }); 
  }, [results, refreshingCard, isCooldown, performAnalysis]);

  const errorToasts = useMemo(() => 
    errors.slice(0, 3).map((error, index) => <ErrorToast key={`${error.timestamp.getTime()}-${index}`} error={error} />)
  , [errors]);

  const handleSymbolChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => { 
    setSelectedSymbol(e.target.value); 
    setApiError(''); 
  }, []);

  const { oiPcrSentiment, volumePcrSentiment, rsiSentiment } = useMemo(() => { 
    if (!results) return { oiPcrSentiment: null, volumePcrSentiment: null, rsiSentiment: null }; 
    return { 
      oiPcrSentiment: getPcrSentiment(results.pcr), 
      volumePcrSentiment: getPcrSentiment(results.volumePcr), 
      rsiSentiment: results.rsi ? getRsiSentiment(results.rsi) : null, 
    }; 
  }, [results]);

  return (
    <div className="bg-brand-dark min-h-screen text-gray-300">
      <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-brand-dark via-brand-dark to-slate-900 -z-10"></div>
      {errorToasts}
      <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <section className="text-center py-16">
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
              disabled={isLoading || !selectedSymbol || symbolList.length === 0 || isCooldown}
              title={isCooldown ? 'Please wait 10 seconds' : 'Analyze selected symbol'}
            >
              {isLoading ? 'Analyzing...' : 'Analyze'}
            </button>
          </div>
          {apiError && (<div className="mt-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-center"><div className="flex items-center justify-center text-red-300"><XCircle size={16} className="mr-2" /><span className="text-sm">{apiError}</span></div></div>)}
          {isCooldown && (
            <div className="mt-2 p-2 bg-yellow-900/30 border border-yellow-700/50 rounded-lg text-center">
              <div className="flex items-center justify-center text-yellow-300">
                <Clock size={14} className="mr-2" />
                <span className="text-sm">Please wait 10 seconds before next request</span>
              </div>
            </div>
          )}
        </section>

        <section id="results" className="mt-12 w-full max-w-6xl mx-auto min-h-[100px]">
          {isLoading && (<div className="flex flex-col items-center justify-center p-8"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-cyan mb-4"></div><p className="text-brand-cyan text-lg">{loadingState === 'ANALYZING' ? 'Querying the chain, please wait...' : 'Refreshing data...'}</p></div>)}
          
          {results && (
            <div className="bg-brand-light-dark/50 backdrop-blur-sm border border-white/10 p-6 rounded-xl shadow-2xl text-left animate-fade-in">
              <h2 className="text-3xl font-bold text-center text-white mb-2">Analysis for <span className="text-brand-cyan">{results.symbol}</span></h2>
              <p className="text-center text-gray-400 mb-1">Expiry Date: {results.expiryDate}</p>
              <div className="flex items-center justify-center mb-6">
                <span className="text-white font-bold">
                  {marketStatus === 'PRE_MARKET' ? 'Previous Close: ' : 'CMP: '}{results.ltp}
                  {results.changePercent !== undefined && (
                    <span className={results.changePercent >= 0 ? 'text-green-400' : 'text-red-500'}>
                      {` (${results.changePercent > 0 ? '+' : ''}${results.changePercent.toFixed(2)}%)`}
                    </span>
                  )}
                </span>
                <span className="text-gray-500 ml-2">(last refreshed {results.lastRefreshed})</span>
                <button 
                  onClick={handleRefreshCard} 
                  disabled={refreshingCard || isCooldown} 
                  className="ml-2 p-1 hover:bg-gray-700 rounded-full transition-colors duration-200 disabled:opacity-50" 
                  title={isCooldown ? 'Please wait 10 seconds' : 'Refresh data'}
                >
                  <RefreshCw size={14} className={refreshingCard ? 'animate-spin' : ''} />
                </button>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 mb-6">
                <SupportResistanceCard type="Support" value={results.support} strength={results.supportStrength} />
                <SupportResistanceCard type="Resistance" value={results.resistance} strength={results.resistanceStrength} />
                
                <VolumeCard 
                  avg20DayVolume={results.avg20DayVolume}
                  todayVolumePercentage={results.todayVolumePercentage}
                  estimatedTodayVolume={results.estimatedTodayVolume}
                  marketStatus={marketStatus}
                />
                
                {marketStatus === 'OPEN' || marketStatus === 'PRE_MARKET' ? (
                  <>
                    <StatCard title="OI PCR Ratio" value={results.pcr} sentiment={oiPcrSentiment?.sentiment} sentimentColor={oiPcrSentiment?.color} />
                    <StatCard title="Volume PCR" value={results.volumePcr} sentiment={volumePcrSentiment?.sentiment} sentimentColor={volumePcrSentiment?.color} />
                  </>
                ) : (
                  <>
                    <MarketHoursOnlyCard title="OI PCR Ratio" marketStatus={marketStatus} />
                    <MarketHoursOnlyCard title="Volume PCR" marketStatus={marketStatus} />
                  </>
                )}
                
                <SentimentCard sentiment={results.sentiment} />
                {results.rsi !== undefined && (
                  <StatCard title="RSI" value={results.rsi} sentiment={rsiSentiment?.sentiment} sentimentColor={rsiSentiment?.color} tooltip="Relative Strength Index. Values below 30 indicate oversold conditions (bullish), above 70 indicate overbought conditions (bearish)." />
                )}
              </div>

              {/* NEW: Open Interest Analysis Section */}
              <OIAnalysisCard oiAnalysis={results.oiAnalysis} marketStatus={marketStatus} />
            </div>
          )}
        </section>

        <section className="w-full max-w-5xl mx-auto mt-24 text-center">
          <h2 className="text-3xl font-bold mb-10">Core Features</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <FeatureCard icon={<BarChart />} title="OI Analysis" description="Visualize support and resistance levels based on real-time Open Interest data." />
            <FeatureCard icon={<TrendingUp />} title="PCR Sentiment" description="Gauge overall market sentiment with the up-to-the-minute Put-Call Ratio." />
            <FeatureCard icon={<ShieldCheck />} title="Technical Indicators" description="Check crucial indicators like Volume, RSI, and Moving Averages for confirmation." />
          </div>
        </section>

        <section className="w-full max-w-2xl mx-auto mt-24 p-8 bg-brand-light-dark/50 backdrop-blur-sm rounded-xl shadow-2xl border border-white/10">
          <h2 className="text-3xl font-bold text-center mb-6">Get In Touch</h2>
          <form className="flex flex-col gap-4">
            <div className="relative"><Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"/><input type="text" placeholder="Your Name" className="w-full pl-10 p-3 bg-gray-900/50 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-cyan" /></div>
            <div className="relative"><Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"/><input type="email" placeholder="Your Email" className="w-full pl-10 p-3 bg-gray-900/50 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-cyan" /></div>
            <textarea placeholder="Your Message" rows={4} className="p-3 bg-gray-900/50 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-cyan"></textarea>
            <button type="submit" className="bg-brand-cyan hover:bg-cyan-500 text-brand-dark font-bold py-3 px-6 rounded-lg transition-all duration-300">Send Message</button>
          </form>
        </section>
      </main>
    </div>
  );
}