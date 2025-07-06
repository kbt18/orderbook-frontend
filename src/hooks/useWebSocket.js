// hooks/useWebSocket.js
import { useState, useEffect, useRef, useCallback } from 'react';

const useWebSocket = (url, options = {}) => {
  const {
    onOpen = () => {},
    onClose = () => {},
    onError = () => {},
    onMessage = () => {},
    reconnectAttempts = 5,
    reconnectInterval = 3000,
    heartbeatInterval = 30000,
    debug = false,
    protocols = [],
    shouldReconnect = true,
    filter = () => true, // Filter function for incoming messages
    retryOnError = true,
    binaryType = 'blob'
  } = options;

  const [readyState, setReadyState] = useState(WebSocket.CONNECTING);
  const [lastMessage, setLastMessage] = useState(null);
  const [lastJsonMessage, setLastJsonMessage] = useState(null);
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);

  const webSocketRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const heartbeatTimeoutRef = useRef(null);
  const messageQueueRef = useRef([]);
  const urlRef = useRef(url);

  // Update URL reference when it changes
  useEffect(() => {
    urlRef.current = url;
  }, [url]);

  const log = useCallback((message, data = '') => {
    if (debug) {
      console.log(`[WebSocket] ${message}`, data);
    }
  }, [debug]);

  const clearTimeouts = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    if (heartbeatInterval > 0) {
      heartbeatTimeoutRef.current = setTimeout(() => {
        if (webSocketRef.current?.readyState === WebSocket.OPEN) {
          log('Sending heartbeat ping');
          webSocketRef.current.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
          startHeartbeat(); // Schedule next heartbeat
        }
      }, heartbeatInterval);
    }
  }, [heartbeatInterval, log]);

  const processMessageQueue = useCallback(() => {
    while (messageQueueRef.current.length > 0 && webSocketRef.current?.readyState === WebSocket.OPEN) {
      const message = messageQueueRef.current.shift();
      webSocketRef.current.send(message);
      log('Sent queued message:', message);
    }
  }, [log]);

  const connect = useCallback(() => {
    if (!urlRef.current) {
      log('No URL provided for WebSocket connection');
      return;
    }

    try {
      log('Attempting to connect to:', urlRef.current);
      setError(null);
      
      // Close existing connection if any
      if (webSocketRef.current) {
        webSocketRef.current.close();
      }

      // Create new WebSocket connection
      webSocketRef.current = new WebSocket(urlRef.current, protocols);
      webSocketRef.current.binaryType = binaryType;

      webSocketRef.current.onopen = (event) => {
        log('WebSocket connected');
        setReadyState(WebSocket.OPEN);
        setIsConnected(true);
        setConnectionAttempts(0);
        setError(null);
        
        startHeartbeat();
        processMessageQueue();
        onOpen(event);
      };

      webSocketRef.current.onclose = (event) => {
        log('WebSocket closed', { code: event.code, reason: event.reason, wasClean: event.wasClean });
        setReadyState(WebSocket.CLOSED);
        setIsConnected(false);
        clearTimeouts();
        
        onClose(event);

        // Attempt to reconnect if configured
        if (shouldReconnect && connectionAttempts < reconnectAttempts && !event.wasClean) {
          const nextAttempt = connectionAttempts + 1;
          setConnectionAttempts(nextAttempt);
          
          const delay = reconnectInterval * Math.pow(1.5, nextAttempt - 1); // Exponential backoff
          log(`Reconnecting in ${delay}ms (attempt ${nextAttempt}/${reconnectAttempts})`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };

      webSocketRef.current.onerror = (event) => {
        log('WebSocket error', event);
        const errorObj = new Error('WebSocket connection error');
        setError(errorObj);
        onError(errorObj);

        if (retryOnError && shouldReconnect) {
          setReadyState(WebSocket.CONNECTING);
        }
      };

      webSocketRef.current.onmessage = (event) => {
        const message = event.data;
        
        // Apply filter
        if (!filter(message)) {
          return;
        }

        setLastMessage(message);
        log('Received message:', message);

        // Try to parse as JSON
        try {
          const jsonMessage = JSON.parse(message);
          setLastJsonMessage(jsonMessage);
          
          // Handle pong responses
          if (jsonMessage.type === 'pong') {
            log('Received heartbeat pong');
            return;
          }
          
          onMessage(jsonMessage, event);
        } catch (parseError) {
          // Not JSON, handle as raw message
          onMessage(message, event);
        }
      };

      setReadyState(WebSocket.CONNECTING);

    } catch (error) {
      log('Failed to create WebSocket:', error);
      setError(error);
      onError(error);
    }
  }, [
    protocols,
    binaryType,
    onOpen,
    onClose,
    onError,
    onMessage,
    shouldReconnect,
    connectionAttempts,
    reconnectAttempts,
    reconnectInterval,
    retryOnError,
    filter,
    log,
    startHeartbeat,
    processMessageQueue,
    clearTimeouts
  ]);

  const disconnect = useCallback(() => {
    log('Manually disconnecting WebSocket');
    clearTimeouts();
    
    if (webSocketRef.current) {
      webSocketRef.current.close(1000, 'Manual disconnect');
    }
    
    setReadyState(WebSocket.CLOSED);
    setIsConnected(false);
  }, [log, clearTimeouts]);

  const sendMessage = useCallback((message) => {
    if (!webSocketRef.current) {
      log('WebSocket not initialized');
      return false;
    }

    if (webSocketRef.current.readyState === WebSocket.OPEN) {
      const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
      webSocketRef.current.send(messageStr);
      log('Sent message:', messageStr);
      return true;
    } else {
      // Queue message for later sending
      const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
      messageQueueRef.current.push(messageStr);
      log('Queued message (WebSocket not ready):', messageStr);
      return false;
    }
  }, [log]);

  const sendJsonMessage = useCallback((message) => {
    return sendMessage(JSON.stringify(message));
  }, [sendMessage]);

  // Subscribe to specific channels or topics
  const subscribe = useCallback((channels) => {
    const subscribeMessage = {
      type: 'subscribe',
      channels: Array.isArray(channels) ? channels : [channels],
      timestamp: Date.now()
    };
    return sendJsonMessage(subscribeMessage);
  }, [sendJsonMessage]);

  // Unsubscribe from channels
  const unsubscribe = useCallback((channels) => {
    const unsubscribeMessage = {
      type: 'unsubscribe',
      channels: Array.isArray(channels) ? channels : [channels],
      timestamp: Date.now()
    };
    return sendJsonMessage(unsubscribeMessage);
  }, [sendJsonMessage]);

  // Get connection statistics
  const getConnectionStats = useCallback(() => {
    return {
      readyState,
      isConnected,
      connectionAttempts,
      queuedMessages: messageQueueRef.current.length,
      url: urlRef.current,
      error
    };
  }, [readyState, isConnected, connectionAttempts, error]);

  // Force reconnect
  const reconnect = useCallback(() => {
    log('Forcing reconnection');
    setConnectionAttempts(0);
    disconnect();
    setTimeout(connect, 100);
  }, [log, disconnect, connect]);

  // Initial connection
  useEffect(() => {
    if (url) {
      connect();
    }

    // Cleanup on unmount
    return () => {
      clearTimeouts();
      if (webSocketRef.current) {
        webSocketRef.current.close();
      }
    };
  }, []); // Only run on mount

  // Reconnect when URL changes
  useEffect(() => {
    if (url && url !== urlRef.current) {
      log('URL changed, reconnecting...');
      reconnect();
    }
  }, [url, reconnect, log]);

  // Ready state constants for convenience
  const readyStateConstants = {
    CONNECTING: WebSocket.CONNECTING,
    OPEN: WebSocket.OPEN,
    CLOSING: WebSocket.CLOSING,
    CLOSED: WebSocket.CLOSED
  };

  return {
    // Connection state
    readyState,
    isConnected,
    connectionAttempts,
    error,
    
    // Messages
    lastMessage,
    lastJsonMessage,
    
    // Actions
    sendMessage,
    sendJsonMessage,
    connect,
    disconnect,
    reconnect,
    subscribe,
    unsubscribe,
    
    // Utilities
    getConnectionStats,
    readyStateConstants,
    
    // Queue info
    queuedMessages: messageQueueRef.current.length
  };
};

export default useWebSocket;