import qrcode from 'qrcode-terminal';
import sodium from 'libsodium-wrappers';
import { initCrypto, generateKeyPair } from './crypto.js';
import { RelayClient } from './relay-client.js';
import type { Config } from './config-store.js';

interface PairOpts {
  relayUrl: string;
}

/**
 * Generates daemon and client keypairs, then prints a QR/URL encoding both.
 * Every paired device (glasses webapp, phone app, future peers) uses the SAME
 * client keypair embedded in the payload, so the daemon only ever tracks one
 * peer public key. Personal-use security trade-off chosen by user.
 *
 * Wire payload version: 2.
 */
export async function runPair(opts: PairOpts): Promise<Config> {
  await initCrypto();
  const daemonKp = generateKeyPair();
  const clientKp = generateKeyPair();
  const channelId = sodium.to_base64(
    sodium.randombytes_buf(16),
    sodium.base64_variants.URLSAFE_NO_PADDING,
  );

  const payload = {
    v: 2,
    channel_id: channelId,
    daemon_pub: sodium.to_base64(daemonKp.publicKey, sodium.base64_variants.ORIGINAL),
    client_pub: sodium.to_base64(clientKp.publicKey, sodium.base64_variants.ORIGINAL),
    client_priv: sodium.to_base64(clientKp.privateKey, sodium.base64_variants.ORIGINAL),
    relay_url: opts.relayUrl,
  };
  const payloadStr = JSON.stringify(payload);
  const webUrl =
    opts.relayUrl.replace(/^wss?:/, (m) => (m === 'wss:' ? 'https:' : 'http:')).replace('/api/ws', '') +
    '/?p=' +
    encodeURIComponent(
      sodium.to_base64(sodium.from_string(payloadStr), sodium.base64_variants.URLSAFE_NO_PADDING),
    );

  process.stdout.write('\nScan this QR with your phone or glasses to pair:\n\n');
  await new Promise<void>((resolve) =>
    qrcode.generate(webUrl, { small: true }, (qr) => {
      process.stdout.write(qr + '\n');
      resolve();
    }),
  );
  process.stdout.write(`Or open this URL in a browser:\n${webUrl}\n\n`);
  process.stdout.write('Note: the same URL can be used to pair multiple devices to this channel.\n\n');

  // No handshake wait — the daemon already knows the client's pubkey (it generated it).
  // We can save the config immediately and exit. The browser/phone will connect on its own
  // when the URL is opened.

  return {
    version: 1,
    relayUrl: opts.relayUrl,
    channelId,
    daemonPublicKey: sodium.to_base64(daemonKp.publicKey, sodium.base64_variants.ORIGINAL),
    daemonPrivateKey: sodium.to_base64(daemonKp.privateKey, sodium.base64_variants.ORIGINAL),
    peerPublicKey: sodium.to_base64(clientKp.publicKey, sodium.base64_variants.ORIGINAL),
  };
}
