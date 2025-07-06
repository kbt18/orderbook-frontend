import React, { useState, useEffect, useMemo } from 'react';
import './OrderBook.css';

const OrderBook = ({ 
  symbol = "BTCUSDT", 
  data = null, 
  maxDepth = 20,
  onPriceClick = null 
}) => {
  const [animatedPrices, setAnimatedPrices] = useState(new Set());

  // Process and sort order book data
  const processedData = useMemo(() => {
    if (!data || !data.Bids || !data.Asks) {
      return { bids: [], asks: [], bestBid: 0, bestAsk: 0, spread: 0 };
    }

    // Convert bids object to array and sort (highest first)
    const bids = Object.entries(data.Bids || {})
      .map(([price, quantity]) => ({
        price: parseFloat(price),
        quantity: parseFloat(quantity),
        total: 0 // Will be calculated below
      }))
      .sort((a, b) => b.price - a.price)
      .slice(0, maxDepth);

    // Convert asks object to array and sort (lowest first)  
    const asks = Object.entries(data.Asks || {})
      .map(([price, quantity]) => ({
        price: parseFloat(price),
        quantity: parseFloat(quantity),
        total: 0 // Will be calculated below
      }))
      .sort((a, b) => a.price - b.price)
      .slice(0, maxDepth);

    // Calculate cumulative totals
    let bidTotal = 0;
    bids.forEach(bid => {
      bidTotal += bid.quantity;
      bid.total = bidTotal;
    });

    let askTotal = 0;
    asks.forEach(ask => {
      askTotal += ask.quantity;
      ask.total = askTotal;
    });

    const bestBid = bids.length > 0 ? bids[0].price : 0;
    const bestAsk = asks.length > 0 ? asks[0].price : 0;
    const spread = bestAsk - bestBid;

    return { bids, asks, bestBid, bestAsk, spread };
  }, [data, maxDepth]);

  // Animate price changes
  useEffect(() => {
    if (data && data.LastUpdate) {
      const timer = setTimeout(() => {
        setAnimatedPrices(new Set());
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [data?.LastUpdate]);

  const formatPrice = (price) => {
    if (price >= 1) {
      return price.toFixed(2);
    } else if (price >= 0.01) {
      return price.toFixed(4);
    } else {
      return price.toFixed(8);
    }
  };

  const formatQuantity = (quantity) => {
    if (quantity >= 1000) {
      return (quantity / 1000).toFixed(2) + 'K';
    } else if (quantity >= 1) {
      return quantity.toFixed(3);
    } else {
      return quantity.toFixed(6);
    }
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString();
  };

  const getDepthPercentage = (total, maxTotal) => {
    return maxTotal > 0 ? (total / maxTotal) * 100 : 0;
  };

  const maxBidTotal = Math.max(...processedData.bids.map(b => b.total), 0);
  const maxAskTotal = Math.max(...processedData.asks.map(a => a.total), 0);

  const handlePriceClick = (price, side) => {
    if (onPriceClick) {
      onPriceClick(price, side);
    }
  };

  if (!data) {
    return (
      <div className="orderbook-container">
        <div className="orderbook-header">
          <h3>Order Book - {symbol}</h3>
          <div className="orderbook-status">Connecting...</div>
        </div>
        <div className="orderbook-loading">
          <div className="loading-spinner"></div>
          <p>Waiting for order book data...</p>
        </div>
      </div>
    );
  }

  const spreadPercent = processedData.bestAsk > 0 
    ? ((processedData.spread / processedData.bestAsk) * 100).toFixed(3)
    : '0.000';

  return (
    <div className="orderbook-container">
      <div className="orderbook-header">
        <div className="orderbook-title">
          <h3>Order Book - {symbol}</h3>
          <div className="orderbook-exchanges">
            {data.Sources && data.Sources.length > 0 && (
              <span className="exchange-badges">
                {data.Sources.map(exchange => (
                  <span key={exchange} className="exchange-badge">{exchange}</span>
                ))}
              </span>
            )}
          </div>
        </div>
        <div className="orderbook-info">
          <div className="spread-info">
            <span className="spread-label">Spread:</span>
            <span className="spread-value">
              ${formatPrice(processedData.spread)} ({spreadPercent}%)
            </span>
          </div>
          <div className="last-update">
            Last: {formatTime(data.LastUpdate)}
          </div>
        </div>
      </div>

      <div className="orderbook-content">
        <div className="orderbook-headers">
          <div className="orderbook-side">
            <div className="side-header asks-header">
              <span>Price (USD)</span>
              <span>Size</span>
              <span>Total</span>
            </div>
          </div>
        </div>

        {/* Asks Section */}
        <div className="orderbook-side asks-side">
          <div className="orderbook-rows">
            {processedData.asks.slice().reverse().map((ask, index) => (
              <div 
                key={`ask-${ask.price}-${index}`}
                className={`orderbook-row ask-row ${animatedPrices.has(`ask-${ask.price}`) ? 'price-flash' : ''}`}
                onClick={() => handlePriceClick(ask.price, 'sell')}
              >
                <div 
                  className="row-background ask-background"
                  style={{ width: `${getDepthPercentage(ask.total, maxAskTotal)}%` }}
                ></div>
                <span className="price ask-price">{formatPrice(ask.price)}</span>
                <span className="quantity">{formatQuantity(ask.quantity)}</span>
                <span className="total">{formatQuantity(ask.total)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Spread Display */}
        <div className="spread-display">
          <div className="spread-row">
            <span className="best-ask">{formatPrice(processedData.bestAsk)}</span>
            <span className="spread-amount">
              ${formatPrice(processedData.spread)}
            </span>
            <span className="best-bid">{formatPrice(processedData.bestBid)}</span>
          </div>
        </div>

        {/* Bids Section */}
        <div className="orderbook-side bids-side">
          <div className="orderbook-rows">
            {processedData.bids.map((bid, index) => (
              <div 
                key={`bid-${bid.price}-${index}`}
                className={`orderbook-row bid-row ${animatedPrices.has(`bid-${bid.price}`) ? 'price-flash' : ''}`}
                onClick={() => handlePriceClick(bid.price, 'buy')}
              >
                <div 
                  className="row-background bid-background"
                  style={{ width: `${getDepthPercentage(bid.total, maxBidTotal)}%` }}
                ></div>
                <span className="price bid-price">{formatPrice(bid.price)}</span>
                <span className="quantity">{formatQuantity(bid.quantity)}</span>
                <span className="total">{formatQuantity(bid.total)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="orderbook-footer">
          <div className="footer-stats">
            <span>Best Bid: <strong className="bid-price">${formatPrice(processedData.bestBid)}</strong></span>
            <span>Best Ask: <strong className="ask-price">${formatPrice(processedData.bestAsk)}</strong></span>
            <span>Mid Price: <strong>${formatPrice((processedData.bestBid + processedData.bestAsk) / 2)}</strong></span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrderBook;