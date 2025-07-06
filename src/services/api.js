// services/api.js
class APIError extends Error {
  constructor(message, status, response) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.response = response;
  }
}

class OrderBookAPI {
  constructor(baseUrl, options = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.timeout = options.timeout || 10000;
    this.retryAttempts = options.retryAttempts || 3;
    this.retryDelay = options.retryDelay || 1000;
    this.debug = options.debug || false;
    
    // Default headers
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers
    };
    
    // Request/response interceptors
    this.requestInterceptors = [];
    this.responseInterceptors = [];
    
    // Cache for GET requests
    this.cache = new Map();
    this.cacheTimeout = options.cacheTimeout || 5000; // 5 seconds default cache
  }

  // Logging helper
  log(message, data = '') {
    if (this.debug) {
      console.log(`[API] ${message}`, data);
    }
  }

  // Add request interceptor
  addRequestInterceptor(interceptor) {
    this.requestInterceptors.push(interceptor);
  }

  // Add response interceptor
  addResponseInterceptor(interceptor) {
    this.responseInterceptors.push(interceptor);
  }

  // Apply request interceptors
  async processRequest(url, options) {
    let processedOptions = { ...options };
    
    for (const interceptor of this.requestInterceptors) {
      processedOptions = await interceptor(url, processedOptions);
    }
    
    return processedOptions;
  }

  // Apply response interceptors
  async processResponse(response, url, options) {
    let processedResponse = response;
    
    for (const interceptor of this.responseInterceptors) {
      processedResponse = await interceptor(processedResponse, url, options);
    }
    
    return processedResponse;
  }

  // Core HTTP request method
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const method = options.method || 'GET';
    
    // Check cache for GET requests
    if (method === 'GET' && this.cache.has(url)) {
      const cached = this.cache.get(url);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        this.log(`Cache hit for ${url}`);
        return cached.data;
      } else {
        this.cache.delete(url);
      }
    }

    const requestOptions = {
      method,
      headers: { ...this.defaultHeaders, ...options.headers },
      signal: AbortSignal.timeout(this.timeout),
      ...options
    };

    // Apply request interceptors
    const processedOptions = await this.processRequest(url, requestOptions);

    this.log(`${method} ${url}`, processedOptions);

    let lastError;
    
    // Retry logic
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const response = await fetch(url, processedOptions);
        
        // Apply response interceptors
        const processedResponse = await this.processResponse(response, url, processedOptions);
        
        if (!processedResponse.ok) {
          const errorText = await processedResponse.text();
          throw new APIError(
            `HTTP ${processedResponse.status}: ${errorText}`,
            processedResponse.status,
            processedResponse
          );
        }

        const contentType = processedResponse.headers.get('content-type');
        let data;
        
        if (contentType && contentType.includes('application/json')) {
          data = await processedResponse.json();
        } else {
          data = await processedResponse.text();
        }

        // Cache successful GET requests
        if (method === 'GET') {
          this.cache.set(url, {
            data,
            timestamp: Date.now()
          });
        }

        this.log(`Success: ${method} ${url}`, data);
        return data;

      } catch (error) {
        lastError = error;
        
        if (error.name === 'AbortError') {
          throw new APIError(`Request timeout after ${this.timeout}ms`, 408);
        }
        
        // Don't retry on client errors (4xx)
        if (error.status >= 400 && error.status < 500) {
          throw error;
        }
        
        // Retry on network errors and server errors (5xx)
        if (attempt < this.retryAttempts) {
          const delay = this.retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
          this.log(`Retry ${attempt}/${this.retryAttempts} in ${delay}ms for ${url}`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  // GET request
  async get(endpoint, params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const url = queryString ? `${endpoint}?${queryString}` : endpoint;
    
    return this.request(url, { method: 'GET' });
  }

  // POST request
  async post(endpoint, data = {}) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  // PUT request
  async put(endpoint, data = {}) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  // DELETE request
  async delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }

  // Clear cache
  clearCache() {
    this.cache.clear();
    this.log('Cache cleared');
  }

  // Get cache stats
  getCacheStats() {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys())
    };
  }

  // ===== ORDER BOOK SPECIFIC METHODS =====

  // Get order book for a specific symbol
  async getOrderBook(symbol, params = {}) {
    const defaultParams = {
      depth: 20,
      ...params
    };
    
    try {
      const data = await this.get(`/api/orderbook/${symbol.toUpperCase()}`, defaultParams);
      
      // Validate response structure
      if (!data || typeof data !== 'object') {
        throw new APIError('Invalid order book response format');
      }
      
      return {
        Symbol: data.Symbol || symbol,
        Bids: data.Bids || {},
        Asks: data.Asks || {},
        LastUpdate: data.LastUpdate || Date.now(),
        Version: data.Version || '0',
        Sources: data.Sources || [],
        ...data
      };
      
    } catch (error) {
      this.log(`Failed to fetch order book for ${symbol}:`, error.message);
      throw error;
    }
  }

  // Get multiple order books at once
  async getMultipleOrderBooks(symbols, params = {}) {
    const requests = symbols.map(symbol => 
      this.getOrderBook(symbol, params).catch(error => ({
        symbol,
        error: error.message
      }))
    );
    
    const results = await Promise.all(requests);
    
    const orderBooks = {};
    const errors = {};
    
    results.forEach(result => {
      if (result.error) {
        errors[result.symbol] = result.error;
      } else {
        orderBooks[result.Symbol] = result;
      }
    });
    
    return { orderBooks, errors };
  }

  // Get market summary for all symbols
  async getMarketSummary() {
    try {
      return await this.get('/api/market/summary');
    } catch (error) {
      this.log('Failed to fetch market summary:', error.message);
      throw error;
    }
  }

  // Get available symbols
  async getSymbols() {
    try {
      const response = await this.get('/api/symbols');
      return Array.isArray(response) ? response : response.symbols || [];
    } catch (error) {
      this.log('Failed to fetch symbols:', error.message);
      throw error;
    }
  }

  // Get server health/status
  async getHealth() {
    try {
      return await this.get('/api/health');
    } catch (error) {
      this.log('Health check failed:', error.message);
      throw error;
    }
  }

  // Get exchange status
  async getExchangeStatus() {
    try {
      return await this.get('/api/exchanges/status');
    } catch (error) {
      this.log('Failed to fetch exchange status:', error.message);
      throw error;
    }
  }

  // Get historical data
  async getHistoricalData(symbol, params = {}) {
    const defaultParams = {
      interval: '1h',
      limit: 100,
      ...params
    };
    
    try {
      return await this.get(`/api/history/${symbol.toUpperCase()}`, defaultParams);
    } catch (error) {
      this.log(`Failed to fetch historical data for ${symbol}:`, error.message);
      throw error;
    }
  }

  // Subscribe to symbol (if your backend supports subscription management)
  async subscribeSymbol(symbol) {
    try {
      return await this.post('/api/subscribe', { symbol: symbol.toUpperCase() });
    } catch (error) {
      this.log(`Failed to subscribe to ${symbol}:`, error.message);
      throw error;
    }
  }

  // Unsubscribe from symbol
  async unsubscribeSymbol(symbol) {
    try {
      return await this.delete(`/api/subscribe/${symbol.toUpperCase()}`);
    } catch (error) {
      this.log(`Failed to unsubscribe from ${symbol}:`, error.message);
      throw error;
    }
  }

  // Get current subscriptions
  async getSubscriptions() {
    try {
      return await this.get('/api/subscriptions');
    } catch (error) {
      this.log('Failed to fetch subscriptions:', error.message);
      throw error;
    }
  }

  // ===== UTILITY METHODS =====

  // Validate symbol format
  static isValidSymbol(symbol) {
    if (typeof symbol !== 'string') return false;
    return /^[A-Z]{2,10}[A-Z]{2,10}$/.test(symbol.toUpperCase());
  }

  // Format price with appropriate decimal places
  static formatPrice(price, symbol = '') {
    const numPrice = parseFloat(price);
    if (isNaN(numPrice)) return '0.00';
    
    // Adjust decimal places based on price magnitude
    if (numPrice >= 1000) return numPrice.toFixed(2);
    if (numPrice >= 1) return numPrice.toFixed(4);
    if (numPrice >= 0.01) return numPrice.toFixed(6);
    return numPrice.toFixed(8);
  }

  // Calculate spread percentage
  static calculateSpreadPercent(bestBid, bestAsk) {
    if (!bestBid || !bestAsk || bestAsk <= bestBid) return 0;
    const midPrice = (bestBid + bestAsk) / 2;
    return ((bestAsk - bestBid) / midPrice) * 100;
  }

  // Parse order book and get best prices
  static getBestPrices(orderBook) {
    if (!orderBook || !orderBook.Bids || !orderBook.Asks) {
      return { bestBid: 0, bestAsk: 0, spread: 0, spreadPercent: 0 };
    }

    const bids = Object.keys(orderBook.Bids)
      .map(price => parseFloat(price))
      .filter(price => !isNaN(price))
      .sort((a, b) => b - a); // Highest first

    const asks = Object.keys(orderBook.Asks)
      .map(price => parseFloat(price))
      .filter(price => !isNaN(price))
      .sort((a, b) => a - b); // Lowest first

    const bestBid = bids.length > 0 ? bids[0] : 0;
    const bestAsk = asks.length > 0 ? asks[0] : 0;
    const spread = bestAsk - bestBid;
    const spreadPercent = this.calculateSpreadPercent(bestBid, bestAsk);

    return { bestBid, bestAsk, spread, spreadPercent };
  }

  // Validate order book structure
  static validateOrderBook(orderBook) {
    const errors = [];
    
    if (!orderBook || typeof orderBook !== 'object') {
      errors.push('Invalid order book format');
      return errors;
    }
    
    if (!orderBook.Symbol || typeof orderBook.Symbol !== 'string') {
      errors.push('Missing or invalid symbol');
    }
    
    if (!orderBook.Bids || typeof orderBook.Bids !== 'object') {
      errors.push('Missing or invalid bids');
    }
    
    if (!orderBook.Asks || typeof orderBook.Asks !== 'object') {
      errors.push('Missing or invalid asks');
    }
    
    return errors;
  }
}

// Create a singleton instance with default configuration
const defaultAPI = new OrderBookAPI('http://localhost:8080', {
  debug: process.env.NODE_ENV === 'development',
  timeout: 10000,
  retryAttempts: 3,
  cacheTimeout: 5000
});

// Add common interceptors
defaultAPI.addRequestInterceptor(async (url, options) => {
  // Add timestamp to prevent caching issues
  if (options.method === 'GET') {
    const separator = url.includes('?') ? '&' : '?';
    url += `${separator}_t=${Date.now()}`;
  }
  return options;
});

defaultAPI.addResponseInterceptor(async (response, url, options) => {
  // Log response times in development
  if (process.env.NODE_ENV === 'development') {
    console.log(`[API] Response time for ${url}: ${Date.now() - options.startTime}ms`);
  }
  return response;
});

export default defaultAPI;
export { OrderBookAPI, APIError };