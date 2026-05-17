import process from 'node:process';
import sodium from 'libsodium-wrappers';
import { ConfigStore } from './config-store.js';
import { initCrypto } from './crypto.js';
import { runPair } from './pair.js';

const args = process.argv.slice(2);
const subcommand = args[0] && !args[0].startsWith('--') ? args[0] : 'run';

function argValue(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

async function cmdPair(): Promise<void> {
  const relayUrl = argValue('--relay-url') ?? process.env.MW_CLAUDE_RELAY_URL;
  if (!relayUrl) {
    process.stderr.write('mw-claude pair: missing --relay-url or MW_CLAUDE_RELAY_URL env\n');
    process.exit(2);
  }
  const cfg = await runPair({ relayUrl });
  new ConfigStore().save(cfg);
  process.stdout.write('\n[mw-claude] Paired! Config saved to ~/.mw-claude/config.json\n');
  process.stdout.write('[mw-claude] Run `mw-claude` (no args) to start the claude session.\n');
}

async function cmdRun(): Promise<void> {
  const cfg = new ConfigStore().load();
  if (!cfg || !cfg.peerPublicKey) {
    process.stderr.write('mw-claude: not paired yet — run `mw-claude pair --relay-url <wss://...>` first\n');
    process.exit(2);
  }
  await initCrypto();
  const { PtySession } = await import('./pty-session.js');
  const { segmentReplies } = await import('./output-parser.js');
  const { RelayClient } = await import('./relay-client.js');

  const myKeyPair = {
    publicKey: sodium.from_base64(cfg.daemonPublicKey, sodium.base64_variants.ORIGINAL),
    privateKey: sodium.from_base64(cfg.daemonPrivateKey, sodium.base64_variants.ORIGINAL),
  };
  const peerPub = sodium.from_base64(cfg.peerPublicKey, sodium.base64_variants.ORIGINAL);

  const session = new PtySession({
    cwd: process.cwd(),
    cols: process.stdout.columns,
    rows: process.stdout.rows,
  });

  const relay = new RelayClient({
    relayUrl: cfg.relayUrl,
    channelId: cfg.channelId,
    role: 'daemon',
    myKeyPair,
    peerPublicKey: peerPub,
  });

  const segmenter = segmentReplies((text) => {
    relay.send(JSON.stringify({ type: 'reply', text }));
  });

  session.on('data', (chunk: string) => {
    process.stdout.write(chunk);
    segmenter.feed(chunk);
  });

  relay.on('message', (pt: string) => {
    try {
      const msg = JSON.parse(pt);
      if (msg.type === 'prompt' && typeof msg.text === 'string') {
        session.write(msg.text + '\r');
      }
    } catch {
      // ignore malformed
    }
  });

  relay.on('open', () => process.stderr.write(`[mw-claude] relay connected (channel ${cfg.channelId})\n`));
  relay.on('close', () => process.stderr.write('[mw-claude] relay disconnected (reconnecting…)\n'));
  relay.on('error', (err: Error) => process.stderr.write(`[mw-claude] relay error: ${err.message}\n`));

  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.on('data', (chunk) => session.write(chunk.toString()));
  process.stdout.on('resize', () =>
    session.resize(process.stdout.columns ?? 120, process.stdout.rows ?? 30),
  );

  session.on('exit', (code: number) => {
    segmenter.flush();
    relay.stop();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.exit(code);
  });

  relay.start();
}

async function main(): Promise<void> {
  if (subcommand === 'pair') return cmdPair();
  if (subcommand === 'run') return cmdRun();
  process.stderr.write(`mw-claude: unknown subcommand "${subcommand}"\n`);
  process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
