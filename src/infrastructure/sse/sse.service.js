// src/infrastructure/sse/sse.service.js
// FIXED: Removed CONNECTION_TIMEOUT_MS. Heartbeat alone keeps connection alive.
// FIXED: Removed lastActivity dead state.
// FIXED: cleanupConnection timer leak resolved.

import { logger } from '#config/logger.js';

// Client registry: Map<userId, Set<{ res, heartbeatInterval, userType, createdAt }>>
const clients = new Map();

// Maximum connections per user
const MAX_CONNECTIONS_PER_USER = 5;

// Heartbeat interval (25 seconds - standard, beats most proxy timeouts)
const HEARTBEAT_INTERVAL_MS = 25000;

/**
 * Register an SSE client connection
 */
export const registerClient = (userId, userType, res) => {
  // Initialize user's connection set if not exists
  if (!clients.has(userId)) {
    clients.set(userId, new Set());
  }

  const userConnections = clients.get(userId);

  // Limit connections per user (prevent abuse)
  if (userConnections.size >= MAX_CONNECTIONS_PER_USER) {
    logger.warn({ userId, current: userConnections.size }, '[SSE] Max connections reached');
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Too many connections' }));
    return false;
  }

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // Nginx/proxy buffering disabled
  });

  // Send initial connection event
  res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);

  // Setup heartbeat
  const heartbeatInterval = setInterval(() => {
    if (!res.writableEnded) {
      res.write(':heartbeat\n\n');
    } else {
      cleanupConnection(userId, heartbeatInterval, res);
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Store connection
  const connection = {
    res,
    heartbeatInterval,
    userType,
    createdAt: Date.now(),
  };

  userConnections.add(connection);

  logger.info(
    {
      userId,
      userType,
      connections: userConnections.size,
      totalClients: getTotalConnections(),
    },
    '[SSE] Client registered'
  );

  // Handle client disconnect
  res.on('close', () => {
    cleanupConnection(userId, heartbeatInterval, res);
  });

  // Handle errors
  res.on('error', err => {
    logger.error({ userId, error: err.message }, '[SSE] Connection error');
    cleanupConnection(userId, heartbeatInterval, res);
  });

  return true;
};

/**
 * Clean up a single connection
 */
const cleanupConnection = (userId, heartbeatInterval, res) => {
  clearInterval(heartbeatInterval);

  const userConnections = clients.get(userId);
  if (userConnections) {
    // Find and remove this specific connection
    for (const conn of userConnections) {
      if (conn.res === res) {
        userConnections.delete(conn);
        break;
      }
    }

    // Remove user entirely if no connections left
    if (userConnections.size === 0) {
      clients.delete(userId);
    }
  }

  if (!res.writableEnded) {
    res.end();
  }

  logger.debug({ userId, remaining: clients.get(userId)?.size || 0 }, '[SSE] Connection closed');
};

/**
 * Remove all connections for a user
 */
export const removeClient = userId => {
  const userConnections = clients.get(userId);
  if (userConnections) {
    for (const conn of userConnections) {
      clearInterval(conn.heartbeatInterval);
      if (!conn.res.writableEnded) {
        conn.res.end();
      }
    }
    clients.delete(userId);
    logger.info({ userId }, '[SSE] All connections removed');
  }
};

/**
 * Push event to a specific user (all their connections)
 */
export const pushSSE = (userId, event) => {
  const userConnections = clients.get(userId);
  if (!userConnections || userConnections.size === 0) {
    return false;
  }

  let sent = 0;
  const deadConnections = [];

  for (const conn of userConnections) {
    const { res } = conn;

    if (res.writableEnded) {
      deadConnections.push(conn);
      continue;
    }

    try {
      const eventString = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
      res.write(eventString);
      sent++;
    } catch (error) {
      logger.error({ userId, eventType: event.type, error: error.message }, '[SSE] Push failed');
      deadConnections.push(conn);
    }
  }

  // Clean up dead connections
  for (const conn of deadConnections) {
    cleanupConnection(userId, conn.heartbeatInterval, conn.res);
  }

  return sent > 0;
};

/**
 * Push event to multiple users
 */
export const pushSSEToAll = (userIds, event) => {
  let sent = 0;
  let failed = 0;

  for (const userId of userIds) {
    const result = pushSSE(userId, event);
    result ? sent++ : failed++;
  }

  logger.debug({ sent, failed, eventType: event.type }, '[SSE] Multicast complete');
  return { sent, failed };
};

/**
 * Broadcast to all connected clients
 */
export const broadcastToAll = event => {
  let sent = 0;

  for (const [userId, userConnections] of clients.entries()) {
    for (const conn of userConnections) {
      try {
        if (!conn.res.writableEnded) {
          const eventString = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
          conn.res.write(eventString);
          sent++;
        }
      } catch (error) {
        logger.error({ userId, error: error.message }, '[SSE] Broadcast failed');
      }
    }
  }

  return sent;
};

/**
 * Get total number of connections
 */
export const getTotalConnections = () => {
  let total = 0;
  for (const connections of clients.values()) {
    total += connections.size;
  }
  return total;
};

export const getConnectedClients = () => {
  const result = [];
  for (const [userId, connections] of clients.entries()) {
    for (const conn of connections) {
      result.push({
        userId,
        userType: conn.userType,
        createdAt: conn.createdAt,
      });
    }
  }
  return result;
};

export const isUserConnected = userId => {
  const connections = clients.get(userId);
  return connections ? connections.size > 0 : false;
};

export const getConnectedCount = () => clients.size;

export const closeAllConnections = () => {
  let closed = 0;
  for (const [userId, connections] of clients.entries()) {
    for (const conn of connections) {
      clearInterval(conn.heartbeatInterval);
      if (!conn.res.writableEnded) {
        conn.res.end();
      }
      closed++;
    }
  }
  clients.clear();
  logger.info({ totalClosed: closed }, '[SSE] All connections closed');
  return closed;
};

export default {
  registerClient,
  removeClient,
  pushSSE,
  pushSSEToAll,
  getConnectedClients,
  isUserConnected,
  getConnectedCount,
  broadcastToAll,
  closeAllConnections,
  getTotalConnections,
};
