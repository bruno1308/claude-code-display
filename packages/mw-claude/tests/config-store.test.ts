import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ConfigStore, type Config } from '../src/config-store.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-claude-cfg-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ConfigStore', () => {
  it('returns null when no config exists', () => {
    const store = new ConfigStore(tmpDir);
    expect(store.load()).toBeNull();
  });

  it('saves and loads a config round-trip', () => {
    const store = new ConfigStore(tmpDir);
    const cfg: Config = {
      version: 1,
      relayUrl: 'wss://example.workers.dev/api/ws',
      channelId: 'abc-123',
      daemonPublicKey: 'pub-base64',
      daemonPrivateKey: 'priv-base64',
      peerPublicKey: 'peer-base64',
    };
    store.save(cfg);
    expect(store.load()).toEqual(cfg);
  });

  it('save() creates the directory if missing', () => {
    const nested = path.join(tmpDir, 'deep', 'nested');
    const store = new ConfigStore(nested);
    store.save({
      version: 1,
      relayUrl: 'x',
      channelId: 'y',
      daemonPublicKey: 'a',
      daemonPrivateKey: 'b',
      peerPublicKey: 'c',
    });
    expect(fs.existsSync(path.join(nested, 'config.json'))).toBe(true);
  });
});
