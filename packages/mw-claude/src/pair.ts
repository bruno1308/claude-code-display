import qrcode from 'qrcode-terminal';
import sodium from 'libsodium-wrappers';
import { initCrypto, generateKeyPair } from './crypto.js';
import { RelayClient } from './relay-client.js';
import type { Config } from './config-store.js';

interface PairOpts {
  relayUrl: string;
}

export async function runPair(opts: PairOpts): Promise<Config> {
  await initCrypto();
  const kp = generateKeyPair();
  const channelId = sodium.to_base64(
    sodium.randombytes_buf(16),
    sodium.base64_variants.URLSAFE_NO_PADDING,
  );

  const payload = {
    v: 1,
    channel_id: channelId,
    daemon_pub: sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL),
    relay_url: opts.relayUrl,
  };
  const payloadStr = JSON.stringify(payload);
  const webUrl =
    opts.relayUrl.replace(/^wss?:/, (m) => (m === 'wss:' ? 'https:' : 'http:')).replace('/api/ws', '') +
    '/?p=' +
    encodeURIComponent(
      sodium.to_base64(sodium.from_string(payloadStr), sodium.base64_variants.URLSAFE_NO_PADDING),
    );

  process.stdout.write('\nScan this QR with the Claude Display client:\n\n');
  await new Promise<void>((resolve) =>
    qrcode.generate(payloadStr, { small: true }, (qr) => {
      process.stdout.write(qr + '\n');
      resolve();
    }),
  );
  process.stdout.write(`Or open this URL in a browser:\n${webUrl}\n\n`);

  const client = new RelayClient({
    relayUrl: opts.relayUrl,
    channelId,
    role: 'daemon',
    myKeyPair: kp,
    peerPublicKey: null,
  });

  process.stdout.write('Waiting for the client (5 min timeout)…\n');

  const peerPub = await new Promise<Uint8Array>((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.stop();
      reject(new Error('Pairing timed out after 5 minutes'));
    }, 5 * 60 * 1000);
    client.on('control', (frame: { type: string; client_pub?: string }) => {
      if (frame.type === 'hello' && frame.client_pub) {
        clearTimeout(timeout);
        const pub = sodium.from_base64(frame.client_pub, sodium.base64_variants.ORIGINAL);
        client.setPeerPublicKey(pub);
        client.sendRaw(JSON.stringify({ type: 'hello_ack' }));
        resolve(pub);
      }
    });
    client.on('error', (err) => process.stderr.write(`[pair] relay error: ${err}\n`));
    client.start();
  });

  client.stop();

  return {
    version: 1,
    relayUrl: opts.relayUrl,
    channelId,
    daemonPublicKey: sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL),
    daemonPrivateKey: sodium.to_base64(kp.privateKey, sodium.base64_variants.ORIGINAL),
    peerPublicKey: sodium.to_base64(peerPub, sodium.base64_variants.ORIGINAL),
  };
}
