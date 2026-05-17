// Loads vendored TweetNaCl scripts and caches the global handle.
// Vendored scripts attach `nacl` and `nacl.util` to window.
let ready;
async function loadNacl() {
  if (window.nacl && window.nacl.util) return window.nacl;
  if (ready) return ready;
  ready = (async () => {
    await loadScript('vendor/nacl.min.js');
    await loadScript('vendor/nacl-util.min.js');
    return window.nacl;
  })();
  return ready;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}

export async function generateKeyPair() {
  const nacl = await loadNacl();
  const kp = nacl.box.keyPair();
  return {
    publicKey: nacl.util.encodeBase64(kp.publicKey),
    secretKey: nacl.util.encodeBase64(kp.secretKey),
  };
}

/** Encrypts `plaintext` (string) for recipient. Returns base64 string of nonce||ciphertext. */
export async function encrypt(plaintext, recipientPubB64, mySecretB64) {
  const nacl = await loadNacl();
  const recipient = nacl.util.decodeBase64(recipientPubB64);
  const mine = nacl.util.decodeBase64(mySecretB64);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const msg = nacl.util.decodeUTF8(plaintext);
  const ct = nacl.box(msg, nonce, recipient, mine);
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce, 0);
  out.set(ct, nonce.length);
  return nacl.util.encodeBase64(out);
}

/** Decrypts base64 of nonce||ciphertext. Returns plaintext string. Throws on failure. */
export async function decrypt(ctB64, senderPubB64, mySecretB64) {
  const nacl = await loadNacl();
  const raw = nacl.util.decodeBase64(ctB64);
  const nonce = raw.slice(0, nacl.box.nonceLength);
  const ct = raw.slice(nacl.box.nonceLength);
  const sender = nacl.util.decodeBase64(senderPubB64);
  const mine = nacl.util.decodeBase64(mySecretB64);
  const pt = nacl.box.open(ct, nonce, sender, mine);
  if (!pt) throw new Error('decryption failed (wrong key or tampered)');
  return nacl.util.encodeUTF8(pt);
}
