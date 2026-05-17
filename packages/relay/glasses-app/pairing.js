import { generateKeyPair } from './crypto.js';

const STORAGE_KEY = 'claude-display.paired.v1';

export function getPaired() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearPairing() {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * If the current URL has `?p=...`, decode the QR payload, generate a fresh
 * keypair, persist to localStorage, and strip `?p=` from the URL.
 * Returns the paired state (existing or newly created), or null if no pairing.
 */
export async function consumeUrlPairing() {
  const url = new URL(window.location.href);
  const p = url.searchParams.get('p');
  if (!p) return getPaired();

  let payload;
  try {
    const json = atob(b64UrlToB64(p));
    payload = JSON.parse(json);
    if (payload.v !== 1) throw new Error('unsupported pairing version');
  } catch (err) {
    return { error: 'pairing payload invalid: ' + err.message };
  }

  // If we're already paired to this same channel, no-op (page reload after pair).
  const existing = getPaired();
  if (existing && existing.channelId === payload.channel_id) {
    cleanUrl();
    return existing;
  }

  // Fresh pairing — generate a new keypair.
  const kp = await generateKeyPair();
  const paired = {
    channelId: payload.channel_id,
    daemonPub: payload.daemon_pub,
    relayUrl: payload.relay_url,
    clientPub: kp.publicKey,
    clientPriv: kp.secretKey,
    pairedAt: Date.now(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(paired));
  cleanUrl();
  return paired;
}

function b64UrlToB64(s) {
  // tweetnacl-util doesn't accept urlsafe-no-padding. Convert.
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  return pad ? padded + '='.repeat(4 - pad) : padded;
}

function cleanUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('p');
  history.replaceState({}, '', url.pathname + (url.search ? '?' + url.searchParams.toString() : ''));
}
