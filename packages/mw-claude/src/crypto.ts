import sodium from 'libsodium-wrappers';

export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export async function initCrypto(): Promise<void> {
  await sodium.ready;
}

export function generateKeyPair(): KeyPair {
  const kp = sodium.crypto_box_keypair();
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

interface EncryptOpts {
  from: KeyPair;
  toPub: Uint8Array;
  plaintext: string;
}

/**
 * Encrypts `plaintext` from `from` to `toPub`. Returns a base64-encoded
 * concatenation of nonce (24 bytes) + ciphertext.
 */
export function encrypt(opts: EncryptOpts): string {
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const pt = sodium.from_string(opts.plaintext);
  const ct = sodium.crypto_box_easy(pt, nonce, opts.toPub, opts.from.privateKey);
  const concat = new Uint8Array(nonce.length + ct.length);
  concat.set(nonce, 0);
  concat.set(ct, nonce.length);
  return sodium.to_base64(concat, sodium.base64_variants.ORIGINAL);
}

interface DecryptOpts {
  to: KeyPair;
  fromPub: Uint8Array;
  ciphertext: string;
}

export function decrypt(opts: DecryptOpts): string {
  const raw = sodium.from_base64(opts.ciphertext, sodium.base64_variants.ORIGINAL);
  const nonce = raw.subarray(0, sodium.crypto_box_NONCEBYTES);
  const ct = raw.subarray(sodium.crypto_box_NONCEBYTES);
  const pt = sodium.crypto_box_open_easy(ct, nonce, opts.fromPub, opts.to.privateKey);
  return sodium.to_string(pt);
}
