// src/orchestrator/services/sse.service.js
// Server-Sent Events (SSE) service for dashboard real-time notifications
// Implements Section 7: Dashboard Notifications (SSE)
//
// Features:
// - Client registry by userId
// - Heartbeat to keep connections alive
// - Automatic cleanup on client disconnect
// - No WebSocket/socket.io — pure SSE
// - X-Accel-Buffering: no for Railway proxy compatibility

import { logger } from '#config/logger.js';

// Client registry: Map<userId, { res, heartbeatInterval, userId }>
const clients = new Map();

/**
 * Register an SSE client connection
 */
export const registerClient = (userId, userType, res) => {
  if (clients.has(userId)) {
    const existing = clients.get(userId);
    clearInterval(existing.heartbeatInterval);
    if (!existing.res.headersSent) {
      existing.res.end();
    }
    clients.delete(userId);
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.write('event: connected\ndata: {}\n\n');

  const heartbeatInterval = setInterval(() => {
    if (!res.writableEnded) {
      res.write(':heartbeat\n\n');
    } else {
      clearInterval(heartbeatInterval);
    }
  }, 25000);

  clients.set(userId, {
    res,
    heartbeatInterval,
    userId,
    userType,
    createdAt: Date.now(),
  });

  logger.debug('SSE client registered', { userId, userType, totalClients: clients.size });

  res.on('close', () => {
    removeClient(userId);
  });
};

export const removeClient = userId => {
  const client = clients.get(userId);
  if (client) {
    clearInterval(client.heartbeatInterval);
    if (!client.res.writableEnded) {
      client.res.end();
    }
    clients.delete(userId);
    logger.debug('SSE client removed', { userId, totalClients: clients.size });
  }
};

export const pushSSE = (userId, event) => {
  const client = clients.get(userId);
  if (!client) {
    logger.debug('SSE push skipped: user not connected', { userId, eventType: event.type });
    return false;
  }

  const { res } = client;
  if (res.writableEnded) {
    removeClient(userId);
    return false;
  }

  try {
    const eventString = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
    res.write(eventString);
    logger.debug('SSE event pushed', { userId, eventType: event.type });
    return true;
  } catch (error) {
    logger.error('SSE push failed', { userId, eventType: event.type, error: error.message });
    removeClient(userId);
    return false;
  }
};

export const pushSSEToAll = (userIds, event) => {
  let sent = 0;
  let failed = 0;
  for (const userId of userIds) {
    const result = pushSSE(userId, event);
    if (result) sent++;
    else failed++;
  }
  logger.debug('SSE push to multiple users', { userIds, sent, failed, eventType: event.type });
  return { sent, failed };
};

export const getConnectedClients = () => {
  return [...clients.entries()].map(([userId, client]) => ({
    userId,
    userType: client.userType,
    createdAt: client.createdAt,
  }));
};

export const isUserConnected = userId => clients.has(userId);
export const getConnectedCount = () => clients.size;

export const broadcastToAll = event => {
  let sent = 0;
  for (const [userId, client] of clients.entries()) {
    try {
      if (!client.res.writableEnded) {
        const eventString = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
        client.res.write(eventString);
        sent++;
      } else {
        removeClient(userId);
      }
    } catch (error) {
      logger.error('SSE broadcast failed', { userId, error: error.message });
      removeClient(userId);
    }
  }
  return sent;
};

export const closeAllConnections = () => {
  const count = clients.size;
  for (const [userId, client] of clients.entries()) {
    clearInterval(client.heartbeatInterval);
    if (!client.res.writableEnded) {
      client.res.end();
    }
  }
  clients.clear();
  logger.info('All SSE connections closed', { totalClosed: count });
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
};
