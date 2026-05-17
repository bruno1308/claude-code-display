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
    if (payload.v !== 1 && payload.v !== 2) throw new Error('unsupported pairing version ' + payload.v);
  } catch (err) {
    return { error: 'pairing payload invalid: ' + err.message };
  }

  // If we're already paired to this same channel, no-op (page reload after pair).
  const existing = getPaired();
  if (existing && existing.channelId === payload.channel_id) {
    cleanUrl();
    return existing;
  }

  // v2: keypair is embedded — shared across all devices paired to this channel.
  // v1: generate a fresh keypair (legacy behavior).
  let clientPub, clientPriv;
  if (payload.v === 2) {
    clientPub = payload.client_pub;
    clientPriv = payload.client_priv;
  } else {
    const kp = await generateKeyPair();
    clientPub = kp.publicKey;
    clientPriv = kp.secretKey;
  }

  const paired = {
    channelId: payload.channel_id,
    daemonPub: payload.daemon_pub,
    relayUrl: payload.relay_url,
    clientPub,
    clientPriv,
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
