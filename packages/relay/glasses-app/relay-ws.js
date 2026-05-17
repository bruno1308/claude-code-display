import { encrypt, decrypt } from './crypto.js';

/**
 * Opens a WebSocket to the relay as role=client. Handles handshake
 * (hello → hello_ack) and bidirectional encrypted msg frames.
 *
 * @param {object} opts
 * @param {object} opts.paired - { channelId, daemonPub, relayUrl, clientPub, clientPriv }
 * @param {(status: string) => void} opts.onStatus
 * @param {(replyObj: object) => void} opts.onMessage - decoded JSON object
 * @returns {{ send: (obj: object) => void, stop: () => void }}
 */
export function connect(opts) {
  const { paired, onStatus, onMessage } = opts;
  let ws = null;
  let stopped = false;
  let backoff = 500;

  function openOnce() {
    if (stopped) return;
    const url = `${paired.relayUrl}?channel=${encodeURIComponent(paired.channelId)}&role=client`;
    ws = new WebSocket(url);

    ws.onopen = () => {
      onStatus('connecting…');
      ws.send(JSON.stringify({ type: 'hello', client_pub: paired.clientPub }));
    };

    ws.onmessage = async (e) => {
      let f;
      try { f = JSON.parse(String(e.data)); } catch { return; }
      if (f.type === 'hello_ack') {
        backoff = 500;
        onStatus('paired & encrypted');
      } else if (f.type === 'peer_disconnect') {
        onStatus('daemon disconnected — waiting');
      } else if (f.type === 'msg' && f.ct) {
        try {
          const pt = await decrypt(f.ct, paired.daemonPub, paired.clientPriv);
          const obj = JSON.parse(pt);
          // any decrypted msg = daemon is alive, refresh status
          onStatus('paired & encrypted');
          onMessage(obj);
        } catch (err) {
          onStatus('decrypt error: ' + err.message);
        }
      }
    };

    ws.onclose = () => {
      ws = null;
      if (stopped) return;
      onStatus(`disconnected — reconnecting in ${Math.round(backoff / 1000)}s`);
      setTimeout(openOnce, backoff);
      backoff = Math.min(backoff * 2, 10000);
    };

    ws.onerror = () => { try { ws?.close(); } catch {} };
  }

  openOnce();

  return {
    async send(obj) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const ct = await encrypt(JSON.stringify(obj), paired.daemonPub, paired.clientPriv);
      ws.send(JSON.stringify({ type: 'msg', ct }));
    },
    stop() {
      stopped = true;
      try { ws?.close(); } catch {}
    },
  };
}
