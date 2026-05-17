import { describe, it, expect, beforeAll } from 'vitest';
import {
  initCrypto,
  generateKeyPair,
  encrypt,
  decrypt,
  type KeyPair,
} from '../src/crypto.js';

let alice: KeyPair;
let bob: KeyPair;

beforeAll(async () => {
  await initCrypto();
  alice = generateKeyPair();
  bob = generateKeyPair();
});

describe('crypto envelope', () => {
  it('round-trips a string', () => {
    const ct = encrypt({ from: alice, toPub: bob.publicKey, plaintext: 'hello world' });
    const pt = decrypt({ to: bob, fromPub: alice.publicKey, ciphertext: ct });
    expect(pt).toBe('hello world');
  });

  it('produces different ciphertext each time (nonce is fresh)', () => {
    const a = encrypt({ from: alice, toPub: bob.publicKey, plaintext: 'same' });
    const b = encrypt({ from: alice, toPub: bob.publicKey, plaintext: 'same' });
    expect(a).not.toBe(b);
  });

  it('rejects tampered ciphertext', () => {
    const ct = encrypt({ from: alice, toPub: bob.publicKey, plaintext: 'secret' });
    const tampered = ct.slice(0, -4) + 'AAAA';
    expect(() => decrypt({ to: bob, fromPub: alice.publicKey, ciphertext: tampered })).toThrow();
  });

  it('rejects wrong recipient', () => {
    const eve = generateKeyPair();
    const ct = encrypt({ from: alice, toPub: bob.publicKey, plaintext: 'secret' });
    expect(() => decrypt({ to: eve, fromPub: alice.publicKey, ciphertext: ct })).toThrow();
  });
});
