import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { verifyToken } from '../utils/jwt';
import { isRevoked } from '../utils/sessions';
import logger from '../utils/logger';

let io: SocketServer;

/** Rooms are per school so broadcasts never cross tenants. */
export function schoolRoom(schoolId: string, role?: string) {
  return role ? `school:${schoolId}:role:${role}` : `school:${schoolId}`;
}

export function initSocketIO(server: HttpServer) {
  io = new SocketServer(server, {
    cors: { origin: (process.env.FRONTEND_URL || 'http://localhost:3000').split(',').map((o) => o.trim()), credentials: true },
    // WebSocket only: works across several worker processes without sticky sessions.
    transports: ['websocket'],
    maxHttpBufferSize: 64 * 1024,
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (typeof token !== 'string' || !token) return next(new Error('Authentication error'));
    try {
      const user = verifyToken(token);
      if (await isRevoked(token, user)) return next(new Error('Authentication error'));
      (socket as any).user = user;
      next();
    } catch {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    const user = (socket as any).user;
    logger.debug(`Socket connected: ${user.id}`);
    socket.join(`user:${user.id}`);
    if (user.schoolId) {
      socket.join(schoolRoom(user.schoolId));
      socket.join(schoolRoom(user.schoolId, user.role));
    }

    socket.on('disconnect', () => logger.debug(`Socket disconnected: ${user.id}`));
  });

  logger.info('Socket.IO initialized');
  return io;
}

export function getIO(): SocketServer {
  if (!io) throw new Error('Socket.IO not initialized');
  return io;
}
