import 'dotenv/config';
import http from 'http';
import app from './app';
import { connectDatabase } from './config/database';
import { connectRedis } from './config/redis';
import { initSocketIO } from './config/socket';
import logger from './utils/logger';
import { startDailyJobs } from './jobs/daily';

const PORT = process.env.PORT || 5000;

async function bootstrap() {
  await connectDatabase();
  await connectRedis();

  const server = http.createServer(app);
  initSocketIO(server);
  startDailyJobs();

  server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT} [${process.env.NODE_ENV}]`);
    logger.info(`REST  → http://localhost:${PORT}/api/v1`);
  });

  process.on('SIGTERM', () => {
    logger.info('SIGTERM received — shutting down gracefully');
    server.close(() => process.exit(0));
  });
}

bootstrap().catch((err) => {
  logger.error('Failed to start server', err);
  process.exit(1);
});
