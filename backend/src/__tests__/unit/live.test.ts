/**
 * Live events across server processes. Two copies of utils/live.ts stand in for two worker
 * processes; a small in-memory bus stands in for Redis publish/subscribe.
 */
import { EventEmitter } from 'events';

const bus = new EventEmitter();
let publishFails = false;

/** The slice of ioredis that utils/live.ts uses. */
function fakeRedis() {
  const makeSubscriber = () => {
    const sub = new EventEmitter() as EventEmitter & { subscribe: (c: string) => Promise<number>; quit: () => Promise<string> };
    let handler: ((raw: string) => void) | undefined;
    let channel = '';
    sub.subscribe = async (c: string) => { channel = c; handler = (raw) => sub.emit('message', c, raw); bus.on(c, handler); return 1; };
    sub.quit = async () => { if (handler) bus.off(channel, handler); return 'OK'; };
    return sub;
  };
  return {
    publish: async (channel: string, raw: string) => {
      if (publishFails) throw new Error('Redis is down');
      bus.emit(channel, raw);
      return 1;
    },
    duplicate: makeSubscriber,
  };
}

jest.mock('../../config/redis', () => ({ getRedis: () => currentRedis }));
let currentRedis: unknown;

type Live = typeof import('../../utils/live');

/** A process: its own copy of the module, and a stand-in Socket.IO server that records what it sends. */
function startProcess(redis: unknown, withSockets = true) {
  let live!: Live;
  currentRedis = redis;
  jest.isolateModules(() => { live = require('../../utils/live'); });
  const emitted: { room: string; event: string; payload: unknown }[] = [];
  const io = { local: { to: (room: string) => ({ emit: (event: string, payload: unknown) => { emitted.push({ room, event, payload }); } }) } };
  return { live, emitted, io, init: () => (withSockets ? live.initLive(io as any) : Promise.resolve()) };
}

describe('live events across processes', () => {
  beforeEach(() => { bus.removeAllListeners(); publishFails = false; });

  it('an event raised in one process reaches the sockets held by every process, once each', async () => {
    const a = startProcess(fakeRedis());
    const b = startProcess(fakeRedis());
    await a.init();
    await b.init();

    await a.live.emitToUsers('school-1', 'notification', [{ userId: 'u1', payload: { id: 'n1' } }]);

    const expected = [{ room: 'school:school-1:user:u1', event: 'notification', payload: { id: 'n1' } }];
    expect(a.emitted).toEqual(expected);
    expect(b.emitted).toEqual(expected);
  });

  it('a background job with no sockets of its own still reaches them', async () => {
    const web = startProcess(fakeRedis());
    const job = startProcess(fakeRedis(), false);
    await web.init();

    await job.live.emitToUsers('school-1', 'notification', [{ userId: 'u1', payload: { id: 'n2' } }]);
    expect(web.emitted).toHaveLength(1);
  });

  it('a whole school is sent in a few messages, not one per person', async () => {
    const a = startProcess(fakeRedis());
    await a.init();
    let messages = 0;
    bus.on('live:events', () => { messages++; });

    await a.live.emitToUsers('school-1', 'notification', Array.from({ length: 1200 }, (_, i) => ({ userId: `u${i}`, payload: { id: `n${i}` } })));
    expect(messages).toBe(3);
    expect(a.emitted).toHaveLength(1200);
    expect(new Set(a.emitted.map((e) => e.room)).size).toBe(1200);
  });

  it('if Redis is down, this process still tells its own sockets', async () => {
    const a = startProcess(fakeRedis());
    await a.init();
    publishFails = true;
    await expect(a.live.emitToUsers('school-1', 'notification', [{ userId: 'u1', payload: { id: 'n3' } }])).resolves.toBeUndefined();
    expect(a.emitted).toHaveLength(1);
  });

  it('without Redis (development) there is one process and events are handed over directly', async () => {
    const dev = startProcess({ get: async () => null }); // the in-memory stand-in has no publish
    await dev.init();
    await dev.live.emitToUsers('school-1', 'notifications:read', [{ userId: 'u1', payload: {} }]);
    expect(dev.emitted).toEqual([{ room: 'school:school-1:user:u1', event: 'notifications:read', payload: {} }]);
  });

  it('never throws when nothing is running (scripts, tests)', async () => {
    const bare = startProcess(undefined, false);
    await expect(bare.live.emitToUsers('school-1', 'notification', [{ userId: 'u1', payload: {} }])).resolves.toBeUndefined();
  });
});
