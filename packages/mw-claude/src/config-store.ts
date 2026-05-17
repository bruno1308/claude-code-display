import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface Config {
  version: 1;
  relayUrl: string;
  channelId: string;
  daemonPublicKey: string;
  daemonPrivateKey: string;
  peerPublicKey: string;
}

export class ConfigStore {
  private file: string;
  private dir: string;

  constructor(dir: string = path.join(os.homedir(), '.mw-claude')) {
    this.dir = dir;
    this.file = path.join(dir, 'config.json');
  }

  load(): Config | null {
    if (!fs.existsSync(this.file)) return null;
    const raw = fs.readFileSync(this.file, 'utf8');
    return JSON.parse(raw) as Config;
  }

  save(cfg: Config): void {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(cfg, null, 2), 'utf8');
  }
}
