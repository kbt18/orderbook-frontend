// services/calculator.js

class OrderBookCalculator {
  
  // ===== PRICE CALCULATIONS =====

  /**
   * Calculate best bid and ask prices from order book
   * @param {Object} orderBook - Order book with Bids and Asks
   * @returns {Object} Best prices and spread information
   */
  static getBestPrices(orderBook) {
    if (!orderBook || !orderBook.Bids || !orderBook.Asks) {
      return {
        bestBid: 0,
        bestAsk: 0,
        spread: 0,
        spreadPercent: 0,
        midPrice: 0
      };
    }

    // Get all bid prices and sort highest first
    const bidPrices = Object.keys(orderBook.Bids)
      .map(price => parseFloat(price))
      .filter(price => !isNaN(price) && price > 0)
      .sort((a, b) => b - a);

    // Get all ask prices and sort lowest first
    const askPrices = Object.keys(orderBook.Asks)
      .map(price => parseFloat(price))
      .filter(price => !isNaN(price) && price > 0)
      .sort((a, b) => a - b);

    const bestBid = bidPrices.length > 0 ? bidPrices[0] : 0;
    const bestAsk = askPrices.length > 0 ? askPrices[0] : 0;
    const spread = bestAsk - bestBid;
    const midPrice = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : 0;
    const spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : 0;

    return {
      bestBid,
      bestAsk,
      spread,
      spreadPercent,
      midPrice
    };
  }

  /**
   * Calculate weighted average price for a given volume
   * @param {Object} orderBook - Order book data
   * @param {number} volume - Volume to calculate VWAP for
   * @param {string} side - 'buy' or 'sell'
   * @returns {Object} VWAP and other metrics
   */
  static calculateVWAP(orderBook, volume, side = 'buy') {
    if (!orderBook || volume <= 0) {
      return { vwap: 0, totalVolume: 0, remainingVolume: volume, priceImpact: 0 };
    }

    const orders = side === 'buy' ? orderBook.Asks : orderBook.Bids;
    if (!orders || Object.keys(orders).length === 0) {
      return { vwap: 0, totalVolume: 0, remainingVolume: volume, priceImpact: 0 };
    }

    // Sort orders by price (ascending for asks, descending for bids)
    const sortedOrders = Object.entries(orders)
      .map(([price, qty]) => ({
        price: parseFloat(price),
        quantity: parseFloat(qty)
      }))
      .filter(order => order.price > 0 && order.quantity > 0)
      .sort((a, b) => side === 'buy' ? a.price - b.price : b.price - a.price);

    let remainingVolume = volume;
    let totalCost = 0;
    let totalFilled = 0;
    const filledOrders = [];

    for (const order of sortedOrders) {
      if (remainingVolume <= 0) break;

      const fillQuantity = Math.min(remainingVolume, order.quantity);
      const fillCost = fillQuantity * order.price;

      totalCost += fillCost;
      totalFilled += fillQuantity;
      remainingVolume -= fillQuantity;

      filledOrders.push({
        price: order.price,
        quantity: fillQuantity,
        cost: fillCost
      });
    }

    const vwap = totalFilled > 0 ? totalCost / totalFilled : 0;
    const bestPrice = this.getBestPrices(orderBook);
    const referencePrice = side === 'buy' ? bestPrice.bestAsk : bestPrice.bestBid;
    const priceImpact = referencePrice > 0 ? ((vwap - referencePrice) / referencePrice) * 100 : 0;

    return {
      vwap,
      totalVolume: totalFilled,
      remainingVolume,
      priceImpact,
      averagePrice: vwap,
      totalCost,
      filledOrders
    };
  }

  /**
   * Calculate market depth at different price levels
   * @param {Object} orderBook - Order book data
   * @param {number} levels - Number of price levels to analyze
   * @returns {Object} Depth analysis
   */
  static calculateMarketDepth(orderBook, levels = 10) {
    if (!orderBook || !orderBook.Bids || !orderBook.Asks) {
      return { bidDepth: [], askDepth: [], totalBidVolume: 0, totalAskVolume: 0 };
    }

    const processSide = (orders, isAsk = false) => {
      const sortedOrders = Object.entries(orders)
        .map(([price, qty]) => ({
          price: parseFloat(price),
          quantity: parseFloat(qty)
        }))
        .filter(order => order.price > 0 && order.quantity > 0)
        .sort((a, b) => isAsk ? a.price - b.price : b.price - a.price)
        .slice(0, levels);

      let cumulativeVolume = 0;
      return sortedOrders.map(order => {
        cumulativeVolume += order.quantity;
        return {
          price: order.price,
          quantity: order.quantity,
          cumulativeVolume,
          total: order.price * order.quantity
        };
      });
    };

    const bidDepth = processSide(orderBook.Bids, false);
    const askDepth = processSide(orderBook.Asks, true);

    const totalBidVolume = bidDepth.reduce((sum, level) => sum + level.quantity, 0);
    const totalAskVolume = askDepth.reduce((sum, level) => sum + level.quantity, 0);

    return {
      bidDepth,
      askDepth,
      totalBidVolume,
      totalAskVolume,
      imbalance: (totalBidVolume - totalAskVolume) / (totalBidVolume + totalAskVolume)
    };
  }

  // ===== VOLUME CALCULATIONS =====

  /**
   * Calculate total volume at different price ranges
   * @param {Object} orderBook - Order book data
   * @param {number} priceRange - Percentage range from best price
   * @returns {Object} Volume statistics
   */
  static calculateVolumeStats(orderBook, priceRange = 1) {
    const bestPrices = this.getBestPrices(orderBook);
    if (!bestPrices.bestBid || !bestPrices.bestAsk) {
      return { bidVolume: 0, askVolume: 0, totalVolume: 0 };
    }

    const bidRange = {
      min: bestPrices.bestBid * (1 - priceRange / 100),
      max: bestPrices.bestBid
    };

    const askRange = {
      min: bestPrices.bestAsk,
      max: bestPrices.bestAsk * (1 + priceRange / 100)
    };

    const calculateRangeVolume = (orders, range) => {
      return Object.entries(orders || {})
        .filter(([price]) => {
          const p = parseFloat(price);
          return p >= range.min && p <= range.max;
        })
        .reduce((sum, [, qty]) => sum + parseFloat(qty), 0);
    };

    const bidVolume = calculateRangeVolume(orderBook.Bids, bidRange);
    const askVolume = calculateRangeVolume(orderBook.Asks, askRange);

    return {
      bidVolume,
      askVolume,
      totalVolume: bidVolume + askVolume,
      volumeRatio: askVolume > 0 ? bidVolume / askVolume : 0
    };
  }

  // ===== MARKET METRICS =====

  /**
   * Calculate order book quality metrics
   * @param {Object} orderBook - Order book data
   * @returns {Object} Quality metrics
   */
  static calculateQualityMetrics(orderBook) {
    const bestPrices = this.getBestPrices(orderBook);
    const depth = this.calculateMarketDepth(orderBook, 20);
    
    if (!bestPrices.bestBid || !bestPrices.bestAsk) {
      return {
        spread: 0,
        spreadBps: 0,
        depth: 0,
        liquidity: 0,
        efficiency: 0,
        stability: 0
      };
    }

    // Spread in basis points
    const spreadBps = (bestPrices.spread / bestPrices.midPrice) * 10000;

    // Liquidity score (higher is better)
    const totalNearVolume = depth.totalBidVolume + depth.totalAskVolume;
    const liquidity = totalNearVolume / bestPrices.midPrice; // Volume per dollar

    // Market efficiency (lower spread and higher liquidity = more efficient)
    const efficiency = liquidity > 0 ? 1 / (spreadBps * (1 / liquidity)) : 0;

    // Price stability (based on order book imbalance)
    const stability = 1 - Math.abs(depth.imbalance || 0);

    return {
      spread: bestPrices.spread,
      spreadBps,
      depth: totalNearVolume,
      liquidity,
      efficiency,
      stability,
      midPrice: bestPrices.midPrice
    };
  }

  // ===== TRADING CALCULATIONS =====

  /**
   * Calculate slippage for a market order
   * @param {Object} orderBook - Order book data
   * @param {number} orderSize - Size of the order
   * @param {string} side - 'buy' or 'sell'
   * @returns {Object} Slippage analysis
   */
  static calculateSlippage(orderBook, orderSize, side = 'buy') {
    const vwap = this.calculateVWAP(orderBook, orderSize, side);
    const bestPrices = this.getBestPrices(orderBook);
    
    const referencePrice = side === 'buy' ? bestPrices.bestAsk : bestPrices.bestBid;
    const slippagePercent = referencePrice > 0 ? 
      ((vwap.vwap - referencePrice) / referencePrice) * 100 : 0;

    return {
      expectedPrice: vwap.vwap,
      slippagePercent,
      slippageAbsolute: vwap.vwap - referencePrice,
      canFillCompletely: vwap.remainingVolume === 0,
      fillableVolume: vwap.totalVolume,
      remainingVolume: vwap.remainingVolume
    };
  }

  /**
   * Calculate optimal order sizes for minimal market impact
   * @param {Object} orderBook - Order book data
   * @param {number} maxSlippage - Maximum acceptable slippage (%)
   * @param {string} side - 'buy' or 'sell'
   * @returns {Object} Optimal sizing recommendations
   */
  static calculateOptimalSizing(orderBook, maxSlippage = 0.1, side = 'buy') {
    const orders = side === 'buy' ? orderBook.Asks : orderBook.Bids;
    if (!orders || Object.keys(orders).length === 0) {
      return { maxSize: 0, recommendations: [] };
    }

    const bestPrices = this.getBestPrices(orderBook);
    const referencePrice = side === 'buy' ? bestPrices.bestAsk : bestPrices.bestBid;
    
    let currentSize = 0;
    const step = Math.max(Object.values(orders)[0] || 0, 0.01);
    const recommendations = [];

    while (currentSize < 1000) { // Test up to reasonable size
      currentSize += step;
      const vwap = this.calculateVWAP(orderBook, currentSize, side);
      
      if (vwap.remainingVolume > 0) break; // Can't fill completely
      
      const slippage = ((vwap.vwap - referencePrice) / referencePrice) * 100;
      
      recommendations.push({
        size: currentSize,
        price: vwap.vwap,
        slippage,
        cost: vwap.totalCost
      });
      
      if (Math.abs(slippage) > maxSlippage) break;
    }

    const maxSize = recommendations.length > 0 ? 
      recommendations[recommendations.length - 1].size : 0;

    return {
      maxSize,
      recommendations,
      referencePrice
    };
  }

  // ===== UTILITY FUNCTIONS =====

  /**
   * Format price with appropriate decimal places
   * @param {number} price - Price to format
   * @param {string} symbol - Trading symbol (optional)
   * @returns {string} Formatted price
   */
  static formatPrice(price, symbol = '') {
    const numPrice = parseFloat(price);
    if (isNaN(numPrice)) return '0.00';
    
    if (numPrice >= 1000) return numPrice.toFixed(2);
    if (numPrice >= 1) return numPrice.toFixed(4);
    if (numPrice >= 0.01) return numPrice.toFixed(6);
    return numPrice.toFixed(8);
  }

  /**
   * Format volume/quantity with appropriate units
   * @param {number} quantity - Quantity to format
   * @returns {string} Formatted quantity
   */
  static formatQuantity(quantity) {
    const num = parseFloat(quantity);
    if (isNaN(num)) return '0';
    
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(2) + 'K';
    if (num >= 1) return num.toFixed(3);
    return num.toFixed(6);
  }

  /**
   * Validate order book structure and data quality
   * @param {Object} orderBook - Order book to validate
   * @returns {Object} Validation results
   */
  static validateOrderBook(orderBook) {
    const issues = [];
    const warnings = [];

    if (!orderBook) {
      issues.push('Order book is null or undefined');
      return { isValid: false, issues, warnings };
    }

    if (!orderBook.Bids || typeof orderBook.Bids !== 'object') {
      issues.push('Missing or invalid bids');
    }

    if (!orderBook.Asks || typeof orderBook.Asks !== 'object') {
      issues.push('Missing or invalid asks');
    }

    if (issues.length > 0) {
      return { isValid: false, issues, warnings };
    }

    // Check for crossed book
    const bestPrices = this.getBestPrices(orderBook);
    if (bestPrices.bestBid >= bestPrices.bestAsk && bestPrices.bestBid > 0 && bestPrices.bestAsk > 0) {
      issues.push('Crossed book detected: best bid >= best ask');
    }

    // Check for reasonable spread
    if (bestPrices.spreadPercent > 10) {
      warnings.push(`Large spread detected: ${bestPrices.spreadPercent.toFixed(2)}%`);
    }

    // Check for empty sides
    if (Object.keys(orderBook.Bids).length === 0) {
      warnings.push('No bids available');
    }

    if (Object.keys(orderBook.Asks).length === 0) {
      warnings.push('No asks available');
    }

    // Check for stale data
    if (orderBook.LastUpdate && Date.now() - orderBook.LastUpdate > 10000) {
      warnings.push('Order book data appears stale (>10 seconds old)');
    }

    return {
      isValid: issues.length === 0,
      issues,
      warnings,
      metrics: bestPrices
    };
  }

  /**
   * Compare order books from multiple exchanges
   * @param {Array} orderBooks - Array of order books with exchange info
   * @returns {Object} Comparison analysis
   */
  static compareOrderBooks(orderBooks) {
    if (!Array.isArray(orderBooks) || orderBooks.length < 2) {
      return { arbitrage: [], bestExchange: null, summary: {} };
    }

    const exchangeData = orderBooks.map(ob => {
      const prices = this.getBestPrices(ob);
      const quality = this.calculateQualityMetrics(ob);
      
      return {
        exchange: ob.Sources?.[0] || ob.Exchange || 'Unknown',
        ...prices,
        ...quality,
        orderBook: ob
      };
    }).filter(data => data.bestBid > 0 && data.bestAsk > 0);

    if (exchangeData.length < 2) {
      return { arbitrage: [], bestExchange: null, summary: {} };
    }

    // Find arbitrage opportunities
    const arbitrage = [];
    for (let i = 0; i < exchangeData.length; i++) {
      for (let j = i + 1; j < exchangeData.length; j++) {
        const buy = exchangeData[i];
        const sell = exchangeData[j];
        
        // Check if we can buy on one exchange and sell on another for profit
        if (buy.bestAsk < sell.bestBid) {
          const profit = sell.bestBid - buy.bestAsk;
          const profitPercent = (profit / buy.bestAsk) * 100;
          
          arbitrage.push({
            buyExchange: buy.exchange,
            sellExchange: sell.exchange,
            buyPrice: buy.bestAsk,
            sellPrice: sell.bestBid,
            profit,
            profitPercent
          });
        }
        
        // Check reverse direction
        if (sell.bestAsk < buy.bestBid) {
          const profit = buy.bestBid - sell.bestAsk;
          const profitPercent = (profit / sell.bestAsk) * 100;
          
          arbitrage.push({
            buyExchange: sell.exchange,
            sellExchange: buy.exchange,
            buyPrice: sell.bestAsk,
            sellPrice: buy.bestBid,
            profit,
            profitPercent
          });
        }
      }
    }

    // Find best exchange overall (considering spread and liquidity)
    const bestExchange = exchangeData.reduce((best, current) => {
      const currentScore = current.efficiency || 0;
      const bestScore = best.efficiency || 0;
      return currentScore > bestScore ? current : best;
    });

    // Summary statistics
    const spreads = exchangeData.map(d => d.spreadPercent);
    const midPrices = exchangeData.map(d => d.midPrice);
    
    const summary = {
      averageSpread: spreads.reduce((a, b) => a + b, 0) / spreads.length,
      averageMidPrice: midPrices.reduce((a, b) => a + b, 0) / midPrices.length,
      spreadRange: { min: Math.min(...spreads), max: Math.max(...spreads) },
      priceRange: { min: Math.min(...midPrices), max: Math.max(...midPrices) },
      exchanges: exchangeData.map(d => d.exchange)
    };

    return {
      arbitrage: arbitrage.sort((a, b) => b.profitPercent - a.profitPercent),
      bestExchange: bestExchange.exchange,
      exchangeData,
      summary
    };
  }
}

export default OrderBookCalculator;