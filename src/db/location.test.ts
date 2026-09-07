import { describe, expect, it } from 'vitest';
import { resolveDatabaseLocation } from './index.js';

/**
 * These cases are the difference between "the bot works" and "the bot silently
 * forgets every rating on the next deploy", so they are pinned explicitly.
 */
describe('resolveDatabaseLocation', () => {
  const hosted = { RAILWAY_SERVICE_ID: 'svc_1' } as NodeJS.ProcessEnv;

  it('uses the local data directory off-platform', () => {
    const location = resolveDatabaseLocation({});
    expect(location.path).toBe('./data/standing.db');
    expect(location.durable).toBe(true);
  });

  it('defaults into the volume when one is mounted', () => {
    const location = resolveDatabaseLocation({ ...hosted, RAILWAY_VOLUME_MOUNT_PATH: '/data' });
    expect(location.path).toBe('/data/standing.db');
    expect(location.durable).toBe(true);
  });

  it('treats a hosted deploy with no volume as ephemeral', () => {
    expect(resolveDatabaseLocation(hosted).durable).toBe(false);
  });

  it('accepts an explicit path inside the volume', () => {
    const location = resolveDatabaseLocation({
      ...hosted,
      RAILWAY_VOLUME_MOUNT_PATH: '/data',
      DATABASE_PATH: '/data/nested/standing.db',
    });
    expect(location.durable).toBe(true);
  });

  it('rejects an explicit path that misses the volume', () => {
    const location = resolveDatabaseLocation({
      ...hosted,
      RAILWAY_VOLUME_MOUNT_PATH: '/data',
      DATABASE_PATH: './data/standing.db',
    });
    expect(location.durable).toBe(false);
    expect(location.reason).toContain('outside the mounted volume');
  });

  it('is not fooled by a path that merely shares a prefix with the volume', () => {
    const location = resolveDatabaseLocation({
      ...hosted,
      RAILWAY_VOLUME_MOUNT_PATH: '/data',
      DATABASE_PATH: '/data2/standing.db',
    });
    expect(location.durable).toBe(false);
  });

  it('leaves an explicit path alone off-platform', () => {
    const location = resolveDatabaseLocation({ DATABASE_PATH: '/tmp/test.db' });
    expect(location).toMatchObject({ path: '/tmp/test.db', durable: true });
  });
});
