// App.js - Updated for Cloud Run deployment
import React, { useState, useEffect, useCallback } from 'react';
import OrderBook from './components/OrderBook';
import useOrderBook from './hooks/useOrderBook';
import './App.css';

function App() {
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT');
  const [selectedSymbols, setSelectedSymbols] = useState(['BTCUSDT', 'ETHUSDT', 'ADAUSDT']);
  const [notifications, setNotifications] = useState([]);

  const WS_URL = 'wss://crypto-aggregator-119288192515.europe-west1.run.app:8080/ws';
  const REST_URL = 'https://crypto-aggregator-119288192515.europe-west1.run.app:8080';

  // Configure the order book hook
  const {
    orderBooks,
    loading,
    isConnected,
    error,
    subscribeToSymbols,
    unsubscribeFromSymbols,
    getOrderBook,
    getBestPrices,
    getMarketSummary,
    stats,
    reconnect
  } = useOrderBook(
    WS_URL,                    // WebSocket URL
    REST_URL,                  // REST API URL
    selectedSymbols,           // Initial symbols to subscribe to
    {
      maxDepth: 20,
      enableWebSocket: true,
      enablePolling: false,     // Disable REST polling since we have WebSocket
      debug: true,
      onUpdate: handleOrderBookUpdate,
      onError: handleOrderBookError
    }
  );

  // Handle order book updates
  function handleOrderBookUpdate(symbol, data) {
    console.log(`Order book updated for ${symbol}`);
    
    // Example: Show notification for significant price changes
    const prices = getBestPrices(symbol);
    if (prices.spread > 100) { // Example: Large spread alert
      addNotification(`Large spread detected for ${symbol}: $${prices.spread.toFixed(2)}`, 'warning');
    }
  }

  // Handle errors
  function handleOrderBookError(error) {
    console.error('Order book error:', error);
    addNotification(`Connection error: ${error.message}`, 'error');
  }

  // Add notification
  const addNotification = useCallback((message, type = 'info') => {
    const notification = {
      id: Date.now(),
      message,
      type,
      timestamp: new Date().toLocaleTimeString()
    };
    
    setNotifications(prev => [notification, ...prev.slice(0, 4)]); // Keep last 5
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== notification.id));
    }, 5000);
  }, []);

  // Handle symbol selection
  const handleSymbolChange = useCallback((newSymbol) => {
    setSelectedSymbol(newSymbol);
    
    // Subscribe to new symbol if not already subscribed
    if (!selectedSymbols.includes(newSymbol)) {
      subscribeToSymbols([newSymbol]);
      setSelectedSymbols(prev => [...prev, newSymbol]);
    }
  }, [selectedSymbols, subscribeToSymbols]);

  // Remove symbol subscription
  const removeSymbol = useCallback((symbol) => {
    if (selectedSymbols.length > 1) { // Keep at least one symbol
      unsubscribeFromSymbols([symbol]);
      setSelectedSymbols(prev => prev.filter(s => s !== symbol));
      
      // Change selected symbol if we removed the current one
      if (selectedSymbol === symbol) {
        const remaining = selectedSymbols.filter(s => s !== symbol);
        setSelectedSymbol(remaining[0]);
      }
    }
  }, [selectedSymbols, selectedSymbol, unsubscribeFromSymbols]);

  // Handle price clicks
  const handlePriceClick = useCallback((price, side) => {
    console.log(`Clicked ${side} price: $${price} for ${selectedSymbol}`);
    addNotification(`Selected ${side} price: $${price}`, 'info');
    
    // Here you could open a trading modal, copy to clipboard, etc.
    navigator.clipboard?.writeText(price.toString());
  }, [selectedSymbol, addNotification]);

  // Get current order book data
  const currentOrderBook = getOrderBook(selectedSymbol);
  const marketSummary = getMarketSummary();

  return (
    <div className="App">
      <header className="app-header">
        <div className="header-left">
          <h1>Crypto Order Book Aggregator</h1>
          <div className="connection-info">
            <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
              {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
            </span>
            {error && (
              <button className="retry-button" onClick={reconnect}>
                Reconnect
              </button>
            )}
          </div>
        </div>

        <div className="header-controls">
          <div className="symbol-selector">
            <label htmlFor="symbol-select">Symbol: </label>
            <select 
              id="symbol-select"
              value={selectedSymbol} 
              onChange={(e) => handleSymbolChange(e.target.value)}
            >
              {selectedSymbols.map(symbol => (
                <option key={symbol} value={symbol}>{symbol}</option>
              ))}
              <option value="BNBUSDT">BNB/USDT</option>
              <option value="SOLUSDT">SOL/USDT</option>
              <option value="DOTUSDT">DOT/USDT</option>
            </select>
          </div>

          <div className="stats-display">
            <span>Updates: {stats.totalUpdates}</span>
            <span>Latency: {stats.averageLatency}ms</span>
            <span>Exchanges: {stats.exchanges.size}</span>
          </div>
        </div>
      </header>

      {/* Notifications */}
      {notifications.length > 0 && (
        <div className="notifications">
          {notifications.map(notification => (
            <div key={notification.id} className={`notification ${notification.type}`}>
              <span className="notification-time">{notification.timestamp}</span>
              <span className="notification-message">{notification.message}</span>
              <button 
                className="notification-close"
                onClick={() => setNotifications(prev => prev.filter(n => n.id !== notification.id))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <main className="app-main">
        <div className="orderbook-section">
          <OrderBook 
            symbol={selectedSymbol}
            data={currentOrderBook}
            maxDepth={20}
            onPriceClick={handlePriceClick}
          />
          
          {loading && (
            <div className="loading-overlay">
              <div className="loading-content">
                <div className="loading-spinner-large"></div>
                <p>Connecting to order book stream...</p>
              </div>
            </div>
          )}
        </div>
        
        <div className="dashboard-section">
          {/* Subscribed Symbols Overview */}
          <div className="info-card">
            <h3>Subscribed Symbols</h3>
            <div className="symbols-grid">
              {selectedSymbols.map(symbol => {
                const prices = getBestPrices(symbol);
                const orderBook = getOrderBook(symbol);
                return (
                  <div key={symbol} className={`symbol-card ${symbol === selectedSymbol ? 'active' : ''}`}>
                    <div className="symbol-header">
                      <span className="symbol-name">{symbol}</span>
                      {selectedSymbols.length > 1 && (
                        <button 
                          className="remove-symbol"
                          onClick={() => removeSymbol(symbol)}
                          title="Remove symbol"
                        >
                          ×
                        </button>
                      )}
                    </div>
                    <div className="symbol-prices">
                      <div className="price-row">
                        <span className="price-label">Bid:</span>
                        <span className="bid-price">${prices.bestBid.toFixed(2)}</span>
                      </div>
                      <div className="price-row">
                        <span className="price-label">Ask:</span>
                        <span className="ask-price">${prices.bestAsk.toFixed(2)}</span>
                      </div>
                      <div className="price-row">
                        <span className="price-label">Spread:</span>
                        <span className="spread-price">${prices.spread.toFixed(2)}</span>
                      </div>
                    </div>
                    <div className="symbol-status">
                      <span className={`update-indicator ${orderBook ? 'active' : 'inactive'}`}>
                        {orderBook ? '●' : '○'}
                      </span>
                      <span className="last-update">
                        {orderBook?.lastUpdate ? 
                          new Date(orderBook.lastUpdate).toLocaleTimeString() : 
                          'No data'
                        }
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Market Summary */}
          <div className="info-card">
            <h3>Market Summary</h3>
            <div className="market-overview">
              {Object.entries(marketSummary).map(([symbol, data]) => (
                <div key={symbol} className="market-row">
                  <span className="market-symbol">{symbol}</span>
                  <span className="market-price">${data.midPrice.toFixed(2)}</span>
                  <span className={`market-spread ${data.spread > 10 ? 'high-spread' : ''}`}>
                    {((data.spread / data.midPrice) * 100).toFixed(3)}%
                  </span>
                  <span className="market-sources">
                    {data.sources.join(', ') || 'N/A'}
                  </span>
                </div>
              ))}
            </div>
          </div>
          
          {/* Connection Statistics */}
          <div className="info-card">
            <h3>Connection Stats</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <span className="stat-label">Total Updates:</span>
                <span className="stat-value">{stats.totalUpdates}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Average Latency:</span>
                <span className="stat-value">{stats.averageLatency}ms</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Connected Exchanges:</span>
                <span className="stat-value">{Array.from(stats.exchanges).join(', ') || 'None'}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Last Update:</span>
                <span className="stat-value">
                  {stats.lastUpdateTime ? 
                    new Date(stats.lastUpdateTime).toLocaleTimeString() : 
                    'Never'
                  }
                </span>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="info-card">
            <h3>Quick Actions</h3>
            <div className="actions-grid">
              <button 
                className="action-button"
                onClick={() => {
                  const newSymbol = prompt('Enter symbol (e.g., LINKUSDT):');
                  if (newSymbol) {
                    handleSymbolChange(newSymbol.toUpperCase());
                  }
                }}
              >
                Add Symbol
              </button>
              <button 
                className="action-button"
                onClick={reconnect}
                disabled={isConnected}
              >
                Reconnect
              </button>
              <button 
                className="action-button"
                onClick={() => {
                  const summary = getMarketSummary();
                  console.table(summary);
                  addNotification('Market summary logged to console', 'info');
                }}
              >
                Export Data
              </button>
              <button 
                className="action-button"
                onClick={() => {
                  setNotifications([]);
                }}
              >
                Clear Notifications
              </button>
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="error-card">
              <h3>Connection Error</h3>
              <p>{error.message}</p>
              <button className="retry-button" onClick={reconnect}>
                Retry Connection
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;