// services/websocket.js
class WebSocketError extends Error {
  constructor(message, code, event) {
    super(message);
    this.name = 'WebSocketError';
    this.code = code;
    this.event = event;
  }
}

class OrderBookWebSocketService {
  constructor(url, options = {}) {
    this.url = url;
    this.options = {
      reconnectAttempts: 10,
      reconnectInterval: 3000,
      heartbeatInterval: 30000,
      maxReconnectInterval: 30000,
      protocols: [],
      debug: false,
      binaryType: 'arraybuffer',
      ...options
    };

    // Connection state
    this.ws = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    this.lastConnectTime = null;
    this.connectionId = null;

    // Event handling
    this.eventListeners = new Map();
    this.messageQueue = [];
    this.subscriptions = new Set();

    // Timers
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.connectionTimer = null;

    // Statistics
    this.stats = {
      totalMessages: 0,
      totalErrors: 0,
      totalReconnects: 0,
      bytesReceived: 0,
      bytesSent: 0,
      averageLatency: 0,
      connectionUptime: 0
    };

    this.latencyMeasurements = [];
  }

  // Event system
  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this.eventListeners.has(event)) {
      this.eventListeners.get(event).delete(callback);
    }
  }

  emit(event, data) {
    if (this.eventListeners.has(event)) {
      this.eventListeners.get(event).forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          this.log('Error in event callback:', error);
        }
      });
    }
  }

  // Logging
  log(message, data = '') {
    if (this.options.debug) {
      console.log(`[WebSocket] ${message}`, data);
    }
  }

  // Generate unique connection ID
  generateConnectionId() {
    return Math.random().toString(36).substr(2, 9);
  }

  // Connect to WebSocket
  async connect() {
    if (this.isConnecting || this.isConnected) {
      this.log('Already connected or connecting');
      return;
    }

    this.isConnecting = true;
    this.connectionId = this.generateConnectionId();
    this.log(`Connecting to ${this.url} (${this.connectionId})`);

    try {
      this.ws = new WebSocket(this.url, this.options.protocols);
      this.ws.binaryType = this.options.binaryType;
      
      // Set connection timeout
      this.connectionTimer = setTimeout(() => {
        if (this.isConnecting) {
          this.ws?.close();
          this.handleConnectionError(new Error('Connection timeout'));
        }
      }, 10000); // 10 second timeout

      this.setupEventHandlers();
      
    } catch (error) {
      this.handleConnectionError(error);
    }
  }

  // Setup WebSocket event handlers
  setupEventHandlers() {
    if (!this.ws) return;

    this.ws.onopen = (event) => {
      this.handleConnectionOpen(event);
    };

    this.ws.onclose = (event) => {
      this.handleConnectionClose(event);
    };

    this.ws.onerror = (event) => {
      this.handleConnectionError(event);
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event);
    };
  }

  // Handle connection open
  handleConnectionOpen(event) {
    this.log('WebSocket connected');
    
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }

    this.isConnected = true;
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    this.lastConnectTime = Date.now();

    // Start heartbeat
    this.startHeartbeat();

    // Process queued messages
    this.processMessageQueue();

    // Re-subscribe to previous subscriptions
    this.resubscribe();

    this.emit('connected', {
      connectionId: this.connectionId,
      event
    });
  }

  // Handle connection close
  handleConnectionClose(event) {
    this.log('WebSocket disconnected', {
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean
    });

    this.cleanup();

    const shouldReconnect = !event.wasClean && 
                           this.reconnectAttempts < this.options.reconnectAttempts;

    this.emit('disconnected', {
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean,
      willReconnect: shouldReconnect
    });

    if (shouldReconnect) {
      this.scheduleReconnect();
    }
  }

  // Handle connection error
  handleConnectionError(error) {
    this.log('WebSocket error:', error);
    this.stats.totalErrors++;

    const wsError = new WebSocketError(
      error.message || 'WebSocket connection error',
      error.code,
      error
    );

    this.emit('error', wsError);

    if (this.isConnecting) {
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  // Handle incoming messages
  handleMessage(event) {
    this.stats.totalMessages++;
    this.stats.bytesReceived += event.data.length || event.data.byteLength || 0;

    let data = event.data;

    try {
      // Handle different data types
      if (typeof data === 'string') {
        // Try to parse JSON
        try {
          data = JSON.parse(data);
        } catch (parseError) {
          // Keep as string if not JSON
        }
      } else if (data instanceof ArrayBuffer) {
        // Handle binary data (protobuf)
        this.log('Received binary message', data.byteLength + ' bytes');
      }

      // Handle heartbeat responses
      if (data && typeof data === 'object' && data.type === 'pong') {
        this.handlePongMessage(data);
        return;
      }

      // Calculate latency if timestamp is provided
      if (data && typeof data === 'object' && data.timestamp) {
        const latency = Date.now() - data.timestamp;
        this.updateLatencyStats(latency);
      }

      this.emit('message', {
        data,
        raw: event.data,
        timestamp: Date.now()
      });

      // Emit specific message types
      if (data && typeof data === 'object' && data.type) {
        this.emit(`message:${data.type}`, data);
      }

    } catch (error) {
      this.log('Error processing message:', error);
      this.emit('messageError', { error, raw: event.data });
    }
  }

  // Handle pong messages for latency calculation
  handlePongMessage(data) {
    if (data.requestTime) {
      const latency = Date.now() - data.requestTime;
      this.updateLatencyStats(latency);
      this.log(`Heartbeat latency: ${latency}ms`);
    }
  }

  // Update latency statistics
  updateLatencyStats(latency) {
    this.latencyMeasurements.push(latency);
    
    // Keep only last 100 measurements
    if (this.latencyMeasurements.length > 100) {
      this.latencyMeasurements.shift();
    }

    // Calculate average
    this.stats.averageLatency = this.latencyMeasurements.reduce((a, b) => a + b, 0) / this.latencyMeasurements.length;
  }

  // Send message
  send(data) {
    if (!this.isConnected || !this.ws) {
      this.log('Queueing message (not connected):', data);
      this.messageQueue.push(data);
      return false;
    }

    try {
      let message;
      
      if (typeof data === 'string') {
        message = data;
      } else if (data instanceof ArrayBuffer) {
        message = data;
      } else {
        message = JSON.stringify(data);
      }

      this.ws.send(message);
      this.stats.bytesSent += message.length || message.byteLength || 0;
      this.log('Sent message:', data);
      return true;

    } catch (error) {
      this.log('Error sending message:', error);
      this.emit('sendError', { error, data });
      return false;
    }
  }

  // Send JSON message
  sendJSON(data) {
    return this.send(JSON.stringify(data));
  }

  // Process queued messages
  processMessageQueue() {
    while (this.messageQueue.length > 0 && this.isConnected) {
      const message = this.messageQueue.shift();
      this.send(message);
    }
  }

  // Start heartbeat mechanism
  startHeartbeat() {
    if (this.options.heartbeatInterval <= 0) return;

    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected) {
        this.sendJSON({
          type: 'ping',
          requestTime: Date.now(),
          connectionId: this.connectionId
        });
      }
    }, this.options.heartbeatInterval);
  }

  // Stop heartbeat
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // Schedule reconnection
  scheduleReconnect() {
    if (this.reconnectTimer) return;

    this.reconnectAttempts++;
    this.stats.totalReconnects++;

    // Exponential backoff with jitter
    const baseDelay = this.options.reconnectInterval;
    const maxDelay = this.options.maxReconnectInterval;
    const exponentialDelay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts - 1), maxDelay);
    const jitter = Math.random() * 1000; // Add up to 1 second jitter
    const delay = exponentialDelay + jitter;

    this.log(`Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts}/${this.options.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  // Cancel reconnection
  cancelReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // Cleanup resources
  cleanup() {
    this.isConnected = false;
    this.isConnecting = false;

    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }

    this.stopHeartbeat();

    if (this.lastConnectTime) {
      this.stats.connectionUptime += Date.now() - this.lastConnectTime;
      this.lastConnectTime = null;
    }
  }

  // Disconnect
  disconnect(code = 1000, reason = 'Manual disconnect') {
    this.log('Manually disconnecting');
    
    this.cancelReconnect();
    
    if (this.ws) {
      this.ws.close(code, reason);
      this.ws = null;
    }
    
    this.cleanup();
    this.subscriptions.clear();
    this.messageQueue.length = 0;
  }

  // Subscribe to symbol/channel
  subscribe(symbol) {
    const subscription = {
      type: 'subscribe',
      symbol: symbol.toUpperCase(),
      timestamp: Date.now()
    };

    this.subscriptions.add(symbol.toUpperCase());
    return this.sendJSON(subscription);
  }

  // Unsubscribe from symbol/channel
  unsubscribe(symbol) {
    const subscription = {
      type: 'unsubscribe',
      symbol: symbol.toUpperCase(),
      timestamp: Date.now()
    };

    this.subscriptions.delete(symbol.toUpperCase());
    return this.sendJSON(subscription);
  }

  // Re-subscribe to all previous subscriptions
  resubscribe() {
    if (this.subscriptions.size === 0) return;

    this.log('Re-subscribing to channels:', Array.from(this.subscriptions));
    
    this.subscriptions.forEach(symbol => {
      this.subscribe(symbol);
    });
  }

  // Get connection statistics
  getStats() {
    const uptime = this.lastConnectTime ? 
      this.stats.connectionUptime + (Date.now() - this.lastConnectTime) :
      this.stats.connectionUptime;

    return {
      ...this.stats,
      connectionUptime: uptime,
      isConnected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      subscriptions: Array.from(this.subscriptions),
      queuedMessages: this.messageQueue.length,
      connectionId: this.connectionId
    };
  }

  // Reset statistics
  resetStats() {
    this.stats = {
      totalMessages: 0,
      totalErrors: 0,
      totalReconnects: 0,
      bytesReceived: 0,
      bytesSent: 0,
      averageLatency: 0,
      connectionUptime: 0
    };
    this.latencyMeasurements = [];
  }

  // Get connection state
  getState() {
    return {
      isConnected: this.isConnected,
      isConnecting: this.isConnecting,
      readyState: this.ws?.readyState,
      url: this.url,
      connectionId: this.connectionId,
      subscriptions: Array.from(this.subscriptions)
    };
  }
}

// Create default instance
const defaultWebSocketService = new OrderBookWebSocketService('ws://localhost:8080/ws', {
  debug: process.env.NODE_ENV === 'development',
  reconnectAttempts: 10,
  heartbeatInterval: 30000,
  maxReconnectInterval: 30000
});

export default defaultWebSocketService;
export { OrderBookWebSocketService, WebSocketError };