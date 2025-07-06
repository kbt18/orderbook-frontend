// hooks/useOrderBook.js
import { useState, useEffect, useCallback, useRef } from 'react';
import useWebSocket from './useWebSocket';

const useOrderBook = (wsUrl, apiUrl, symbols = [], options = {}) => {
  const {
    maxDepth = 20,
    updateInterval = 1000,
    enableWebSocket = true,
    enablePolling = false,
    debug = false,
    onError = () => {},
    onUpdate = () => {},
    filter = null
  } = options;

  const [orderBooks, setOrderBooks] = useState({});
  const [loading, setLoading] = useState(true);
  const [subscriptions, setSubscriptions] = useState(new Set());
  const [lastUpdate, setLastUpdate] = useState(null);
  const [stats, setStats] = useState({
    totalUpdates: 0,
    lastUpdateTime: null,
    averageLatency: 0,
    exchanges: new Set()
  });

  const pollingIntervalRef = useRef(null);
  const latencyRef = useRef([]);

const handleWebSocketMessage = useCallback((message) => {
  try {
    let data = message;
    
    if (typeof message === 'string') {
      data = JSON.parse(message);
    }

    // Handle order book updates
    if (data.type === 'orderbook_update' || data.data) {
      const rawOrderBook = data.data || data;
      const symbol = rawOrderBook.Symbol || rawOrderBook.symbol;
      
      if (!symbol) return;

      // Transform array format to map format
      const transformedOrderBook = {
        Symbol: symbol,
        Bids: {},
        Asks: {},
        LastUpdate: rawOrderBook.LastUpdate || Date.now(),
        Sources: rawOrderBook.Sources || [],
        Exchange: rawOrderBook.Exchange || 'MEXC'
      };

      // Convert Bids array to object
      if (Array.isArray(rawOrderBook.Bids)) {
        rawOrderBook.Bids.forEach(bid => {
          const price = bid.Price || bid.price;
          const quantity = bid.Quantity || bid.quantity;
          if (price && quantity) {
            transformedOrderBook.Bids[price.toString()] = quantity.toString();
          }
        });
      } else if (rawOrderBook.Bids && typeof rawOrderBook.Bids === 'object') {
        transformedOrderBook.Bids = rawOrderBook.Bids;
      }

      // Convert Asks array to object  
      if (Array.isArray(rawOrderBook.Asks)) {
        rawOrderBook.Asks.forEach(ask => {
          const price = ask.Price || ask.price;
          const quantity = ask.Quantity || ask.quantity;
          if (price && quantity) {
            transformedOrderBook.Asks[price.toString()] = quantity.toString();
          }
        });
      } else if (rawOrderBook.Asks && typeof rawOrderBook.Asks === 'object') {
        transformedOrderBook.Asks = rawOrderBook.Asks;
      }

      console.log('✅ Transformed order book:', transformedOrderBook);

      // Update state with transformed data
      setOrderBooks(prev => ({
        ...prev,
        [symbol]: {
          ...transformedOrderBook,
          lastUpdate: Date.now(),
          receivedAt: Date.now()
        }
      }));

      setLastUpdate(Date.now());
      onUpdate(symbol, transformedOrderBook);
    }
  } catch (error) {
    console.error('Error processing WebSocket message:', error);
    onError(error);
  }
}, [onUpdate, onError]);

  // Initialize WebSocket connection
  const {
    isConnected,
    readyState,
    sendJsonMessage,
    subscribe: wsSubscribe,
    unsubscribe: wsUnsubscribe,
    error: wsError,
    reconnect,
    getConnectionStats
  } = useWebSocket(enableWebSocket ? wsUrl : null, {
    onMessage: handleWebSocketMessage,
    onOpen: () => {
      console.log('OrderBook WebSocket connected');
      setLoading(false);
      
      // Resubscribe to symbols
      if (symbols.length > 0) {
        subscribeToSymbols(symbols);
      }
    },
    onClose: () => {
      console.log('OrderBook WebSocket disconnected');
    },
    onError: (error) => {
      console.error('OrderBook WebSocket error:', error);
      onError(error);
    },
    shouldReconnect: true,
    reconnectAttempts: 10,
    heartbeatInterval: 30000,
    debug
  });

  // REST API polling fallback
  const fetchOrderBookREST = useCallback(async (symbol) => {
    if (!apiUrl) return null;

    try {
      const response = await fetch(`${apiUrl}/api/orderbook/${symbol}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      const timestamp = Date.now();
      
      setOrderBooks(prev => ({
        ...prev,
        [symbol]: {
          ...data,
          lastUpdate: timestamp,
          receivedAt: timestamp
        }
      }));
      
      return data;
    } catch (error) {
      console.error(`Failed to fetch order book for ${symbol}:`, error);
      onError(error);
      return null;
    }
  }, [apiUrl, onError]);

  // Subscribe to symbol updates
  const subscribeToSymbols = useCallback((symbolList) => {
    if (!Array.isArray(symbolList)) {
      symbolList = [symbolList];
    }

    const newSubscriptions = new Set(subscriptions);
    
    symbolList.forEach(symbol => {
      if (!newSubscriptions.has(symbol)) {
        newSubscriptions.add(symbol);
        
        if (enableWebSocket && isConnected) {
          // Subscribe via WebSocket
          wsSubscribe(`orderbook.${symbol}`);
          if (debug) {
            console.log(`[OrderBook] Subscribed to ${symbol} via WebSocket`);
          }
        }
        
        if (enablePolling) {
          // Fetch initial data via REST
          fetchOrderBookREST(symbol);
        }
      }
    });
    
    setSubscriptions(newSubscriptions);
  }, [subscriptions, enableWebSocket, isConnected, wsSubscribe, enablePolling, fetchOrderBookREST, debug]);

  // Unsubscribe from symbol updates
  const unsubscribeFromSymbols = useCallback((symbolList) => {
    if (!Array.isArray(symbolList)) {
      symbolList = [symbolList];
    }

    const newSubscriptions = new Set(subscriptions);
    
    symbolList.forEach(symbol => {
      if (newSubscriptions.has(symbol)) {
        newSubscriptions.delete(symbol);
        
        if (enableWebSocket && isConnected) {
          wsUnsubscribe(`orderbook.${symbol}`);
          if (debug) {
            console.log(`[OrderBook] Unsubscribed from ${symbol}`);
          }
        }
        
        // Remove from order books
        setOrderBooks(prev => {
          const newOrderBooks = { ...prev };
          delete newOrderBooks[symbol];
          return newOrderBooks;
        });
      }
    });
    
    setSubscriptions(newSubscriptions);
  }, [subscriptions, enableWebSocket, isConnected, wsUnsubscribe, debug]);

  // Get order book for specific symbol
  const getOrderBook = useCallback((symbol) => {
    return orderBooks[symbol] || null;
  }, [orderBooks]);

  // Get best prices for a symbol
  const getBestPrices = useCallback((symbol) => {
    const orderBook = orderBooks[symbol];
    if (!orderBook || !orderBook.Bids || !orderBook.Asks) {
      return { bestBid: 0, bestAsk: 0, spread: 0, midPrice: 0 };
    }

    const bids = Object.entries(orderBook.Bids)
      .map(([price, qty]) => ({ price: parseFloat(price), quantity: parseFloat(qty) }))
      .sort((a, b) => b.price - a.price);

    const asks = Object.entries(orderBook.Asks)
      .map(([price, qty]) => ({ price: parseFloat(price), quantity: parseFloat(qty) }))
      .sort((a, b) => a.price - b.price);

    const bestBid = bids.length > 0 ? bids[0].price : 0;
    const bestAsk = asks.length > 0 ? asks[0].price : 0;
    const spread = bestAsk - bestBid;
    const midPrice = (bestBid + bestAsk) / 2;

    return { bestBid, bestAsk, spread, midPrice };
  }, [orderBooks]);

  // Get aggregated market data
  const getMarketSummary = useCallback(() => {
    const symbols = Object.keys(orderBooks);
    const summary = {};

    symbols.forEach(symbol => {
      const prices = getBestPrices(symbol);
      const orderBook = orderBooks[symbol];
      
      summary[symbol] = {
        ...prices,
        lastUpdate: orderBook?.lastUpdate,
        sources: orderBook?.Sources || [],
        volume: calculateVolume(orderBook),
        depth: calculateDepth(orderBook)
      };
    });

    return summary;
  }, [orderBooks, getBestPrices]);

  // Helper function to calculate volume
  const calculateVolume = (orderBook) => {
    if (!orderBook?.Bids || !orderBook?.Asks) return { bidVolume: 0, askVolume: 0 };

    const bidVolume = Object.values(orderBook.Bids)
      .reduce((sum, qty) => sum + parseFloat(qty), 0);
    
    const askVolume = Object.values(orderBook.Asks)
      .reduce((sum, qty) => sum + parseFloat(qty), 0);

    return { bidVolume, askVolume };
  };

  // Helper function to calculate depth
  const calculateDepth = (orderBook) => {
    if (!orderBook?.Bids || !orderBook?.Asks) return { bidCount: 0, askCount: 0 };

    return {
      bidCount: Object.keys(orderBook.Bids).length,
      askCount: Object.keys(orderBook.Asks).length
    };
  };

  // Setup polling if enabled
  useEffect(() => {
    if (enablePolling && symbols.length > 0) {
      const poll = async () => {
        for (const symbol of symbols) {
          await fetchOrderBookREST(symbol);
        }
      };

      // Initial fetch
      poll();

      // Setup interval
      pollingIntervalRef.current = setInterval(poll, updateInterval);

      return () => {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
        }
      };
    }
  }, [enablePolling, symbols, updateInterval, fetchOrderBookREST]);

  // Subscribe to initial symbols
  useEffect(() => {
    if (symbols.length > 0) {
      subscribeToSymbols(symbols);
    }

    return () => {
      // Cleanup subscriptions on unmount
      if (subscriptions.size > 0) {
        unsubscribeFromSymbols(Array.from(subscriptions));
      }
    };
  }, [symbols]);

  // Update loading state
  useEffect(() => {
    if (enableWebSocket) {
      setLoading(!isConnected);
    } else if (enablePolling) {
      setLoading(Object.keys(orderBooks).length === 0);
    }
  }, [enableWebSocket, enablePolling, isConnected, orderBooks]);

  return {
    // Data
    orderBooks,
    subscriptions: Array.from(subscriptions),
    lastUpdate,
    stats,
    
    // State
    loading,
    isConnected,
    readyState,
    error: wsError,
    
    // Actions
    subscribeToSymbols,
    unsubscribeFromSymbols,
    reconnect,
    refresh: () => symbols.forEach(fetchOrderBookREST),
    
    // Getters
    getOrderBook,
    getBestPrices,
    getMarketSummary,
    getConnectionStats,
    
    // Utils
    sendMessage: sendJsonMessage
  };
};

export default useOrderBook;