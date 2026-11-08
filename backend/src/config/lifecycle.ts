import { basePrisma } from './database';
import { getRedis } from './redis';

/** Set when the process starts shutting down; /ready then reports 503 so the proxy stops sending traffic. */
let draining = false;
export const lifecycle = {
  startDraining() { draining = true; },
  get draining() { return draining; },
};

async function within<T>(ms: number, p: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms); });
  try { return await Promise.race([p, timeout]); } finally { clearTimeout(timer); }
}

/** Readiness: can this instance serve requests right now (database and Redis reachable)? */
export async function readiness() {
  const checks: Record<string, { ok: boolean; ms?: number; error?: string }> = {};
  const probe = async (name: string, fn: () => Promise<unknown>) => {
    const t = Date.now();
    try { await within(2000, fn()); checks[name] = { ok: true, ms: Date.now() - t }; }
    catch (err) { checks[name] = { ok: false, error: (err as Error).message.slice(0, 200) }; }
  };
  await Promise.all([
    // Tagged template: Prisma sends it as a parameterised statement.
    probe('database', () => basePrisma.$queryRaw`SELECT 1`),
    probe('redis', async () => { const r = getRedis() as any; if (typeof r.ping === 'function') await r.ping(); }),
  ]);
  const ok = !draining && Object.values(checks).every((c) => c.ok);
  return { ok, draining, checks };
}
