/**
 * Runs after every test file: closes the connections that file opened, so the test run
 * can end. With a real Redis server (as in CI) an open connection keeps Jest alive forever.
 */
afterAll(async () => {
  try {
    const { getRedis } = await import('../config/redis');
    await (getRedis() as any).quit?.();
  } catch {
    /* this file never connected to Redis, or mocked it */
  }
  try {
    const { basePrisma } = await import('../config/database');
    await basePrisma.$disconnect();
  } catch {
    /* this file never touched the database, or mocked it */
  }
});
