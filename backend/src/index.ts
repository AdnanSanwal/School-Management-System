import 'dotenv/config';
import cluster from 'cluster';
import http from 'http';
import os from 'os';
import logger from './utils/logger';
import { validateEnv } from './config/env';

/**
 * Process entry point.
 *  - Checks configuration first (production refuses weak or missing secrets).
 *  - WEB_CONCURRENCY > 1 runs that many worker processes on one port (Node cluster), so a
 *    single server uses all its CPU cores. Workers that crash are replaced. Rate limits,
 *    sessions and the daily-job lock live in Redis, so workers agree with each other.
 *  - SIGTERM/SIGINT: stop taking new connections, let in-flight requests finish, close the
 *    database and Redis, exit. Anything still running after SHUTDOWN_TIMEOUT_MS is cut.
 *  - An uncaught exception or unhandled rejection is logged and the process exits (the
 *    cluster primary, Docker or the process manager starts a clean one).
 */
const env = validateEnv();
if (!env.ok) {
  for (const p of env.problems) logger.error(`Configuration error: ${p}`);
  if (process.env.NODE_ENV === 'production') process.exit(1);
}

const PORT = Number(process.env.PORT) || 5000;
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 15_000;
const requested = process.env.WEB_CONCURRENCY === 'auto' ? os.availableParallelism() : Number(process.env.WEB_CONCURRENCY) || 1;
// Several workers only make sense with a shared Redis; the in-memory fallback is per process.
const workers = process.env.REDIS_URL ? Math.max(1, Math.min(requested, 16)) : 1;

if (workers > 1 && cluster.isPrimary) {
  runPrimary();
} else {
  startWorker().catch((err) => {
    logger.error('Failed to start server', { error: err.message, stack: err.stack });
    process.exit(1);
  });
}

function runPrimary() {
  logger.info(`Starting ${workers} workers on port ${PORT}`);
  let stopping = false;
  const fork = () => cluster.fork();
  for (let i = 0; i < workers; i++) fork();

  const recentCrashes: number[] = [];
  cluster.on('exit', (worker, code, signal) => {
    if (stopping) return;
    logger.error('Worker died, starting a new one', { workerPid: worker.process.pid, code, signal });
    // Don't spin forever if the code crashes on start-up.
    const now = Date.now();
    recentCrashes.push(now);
    while (recentCrashes.length && now - recentCrashes[0] > 60_000) recentCrashes.shift();
    if (recentCrashes.length > workers * 5) {
      logger.error('Workers keep crashing; giving up');
      process.exit(1);
    }
    setTimeout(fork, 1000);
  });

  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info(`${signal} received, stopping workers`);
    for (const w of Object.values(cluster.workers ?? {})) w?.process.kill('SIGTERM');
    setTimeout(() => process.exit(0), SHUTDOWN_TIMEOUT_MS + 2000).unref();
    cluster.on('exit', () => { if (!Object.keys(cluster.workers ?? {}).length) process.exit(0); });
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

async function startWorker() {
  // Loaded here so the cluster primary never opens database or Redis connections.
  const { default: app } = await import('./app');
  const { connectDatabase, basePrisma } = await import('./config/database');
  const { connectRedis, getRedis } = await import('./config/redis');
  const { initSocketIO } = await import('./config/socket');
  const { startDailyJobs, stopDailyJobs } = await import('./jobs/daily');
  const { lifecycle } = await import('./config/lifecycle');

  await connectDatabase();
  await connectRedis();

  const server = http.createServer(app);
  // Behind Caddy: keep idle connections open longer than the proxy does, and never let a
  // slow client hold a socket forever.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 120_000; // big PDF/Excel reports
  // While draining, tell the proxy not to reuse this connection, so connections close as
  // soon as their last response is sent instead of keeping the shutdown waiting.
  server.on('request', (_req, res) => { if (lifecycle.draining) res.setHeader('Connection', 'close'); });
  const io = initSocketIO(server);
  startDailyJobs();

  server.listen(PORT, () => {
    logger.info(`Server listening on port ${PORT} [${process.env.NODE_ENV ?? 'development'}]${cluster.isWorker ? ` worker ${cluster.worker?.id}` : ''}`);
  });

  let shuttingDown = false;
  const shutdown = async (reason: string, exitCode: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    lifecycle.startDraining();
    logger.info(`Shutting down (${reason})`);
    const force = setTimeout(() => {
      logger.error(`Shutdown took longer than ${SHUTDOWN_TIMEOUT_MS} ms; forcing exit`);
      process.exit(exitCode || 1);
    }, SHUTDOWN_TIMEOUT_MS);
    force.unref();

    stopDailyJobs();
    io.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // Keep-alive connections that finish their request become idle later: close them as
      // they do, so in-flight requests complete and nothing waits for the hard timeout.
      server.closeIdleConnections?.();
      const sweep = setInterval(() => server.closeIdleConnections?.(), 250);
      sweep.unref();
    });
    await Promise.allSettled([basePrisma.$disconnect(), (getRedis() as any).quit?.()]);
    logger.info('Shutdown complete');
    clearTimeout(force);
    process.exit(exitCode);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM', 0));
  process.on('SIGINT', () => shutdown('SIGINT', 0));
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { error: reason instanceof Error ? reason.message : String(reason), stack: (reason as Error)?.stack });
    shutdown('unhandledRejection', 1);
  });
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    shutdown('uncaughtException', 1);
  });
}
