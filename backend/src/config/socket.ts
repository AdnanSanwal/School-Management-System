import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import client from 'prom-client';
import { verifyToken } from '../utils/jwt';
import { validateBranchToken } from '../utils/branches';
import { isRevoked } from '../utils/sessions';
import { closeLive, initLive, userRoom } from '../utils/live';
import logger from '../utils/logger';

/**
 * The live connection each open web page and mobile app keeps to the server. It only
 * carries small "something new for you" events from server to client; everything else
 * goes through the normal API. Events are raised with utils/live.ts.
 */

/** One person rarely has more than a few tabs and a phone; more than this is a runaway client. */
const MAX_CONNECTIONS_PER_USER = 8;

const connected = new client.Gauge({ name: 'live_connections', help: 'Open live (Socket.IO) connections held by this process' });

let io: SocketServer;

export function initSocketIO(server: HttpServer) {
  const origins = [
    ...(process.env.FRONTEND_URL || 'http://localhost:3000').split(',').map((o) => o.trim()),
    ...(process.env.MOBILE_ORIGIN ? [process.env.MOBILE_ORIGIN] : []),
  ];
  io = new SocketServer(server, {
    cors: { origin: origins, credentials: true },
    // WebSocket only: works across several worker processes without sticky sessions.
    transports: ['websocket'],
    // Clients never send anything meaningful: keep what they may send tiny.
    maxHttpBufferSize: 4 * 1024,
    // A dead phone connection is noticed within about 45 seconds.
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (typeof token !== 'string' || !token) return next(new Error('Authentication error'));
    try {
      const user = verifyToken(token);
      if (await isRevoked(token, user)) return next(new Error('Authentication error'));
      await validateBranchToken(user);
      (socket as any).user = user;
      (socket as any).token = token;
      next();
    } catch {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    const user = (socket as any).user;
    const room = userRoom(user.schoolId, user.id);
    if ((io.of('/').adapter.rooms.get(room)?.size ?? 0) >= MAX_CONNECTIONS_PER_USER) {
      socket.disconnect(true);
      return;
    }
    socket.join(room);
    connected.inc();
    socket.on('disconnect', () => connected.dec());
  });

  // Re-check every minute: a signed-out, deactivated or expired session loses its live
  // connection instead of keeping it until the browser closes (WS-1). The client then
  // reconnects with its refreshed token.
  const sweep = setInterval(async () => {
    for (const socket of io.of('/').sockets.values()) {
      const s = socket as any;
      try {
        const payload = verifyToken(s.token);
        if (await isRevoked(s.token, payload)) socket.disconnect(true);
        else await validateBranchToken(payload);
      } catch { socket.disconnect(true); }
    }
  }, 60_000);
  sweep.unref();

  initLive(io).catch((err) => logger.error('Live events could not start', { message: (err as Error).message }));
  logger.info('Socket.IO initialized');
  return io;
}

export async function closeSocketIO() {
  await closeLive();
  await new Promise<void>((resolve) => { if (io) io.close(() => resolve()); else resolve(); });
}
