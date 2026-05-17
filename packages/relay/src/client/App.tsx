import { useEffect, useRef, useState } from 'react';
import sodium from 'libsodium-wrappers';

interface PairedState {
  channelId: string;
  daemonPub: string;
  relayUrl: string;
  clientPub: string;
  clientPriv: string;
}

interface QrPayload {
  v: 1;
  channel_id: string;
  daemon_pub: string;
  relay_url: string;
}

const STORAGE_KEY = 'mw-claude.paired.v1';

function loadPaired(): PairedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PairedState) : null;
  } catch {
    return null;
  }
}

function savePaired(s: PairedState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

async function completePairing(qr: QrPayload): Promise<PairedState> {
  await sodium.ready;
  const kp = sodium.crypto_box_keypair();
  return {
    channelId: qr.channel_id,
    daemonPub: qr.daemon_pub,
    relayUrl: qr.relay_url,
    clientPub: sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL),
    clientPriv: sodium.to_base64(kp.privateKey, sodium.base64_variants.ORIGINAL),
  };
}

export function App() {
  const [paired, setPaired] = useState<PairedState | null>(null);
  const [status, setStatus] = useState('initializing…');
  const [log, setLog] = useState<Array<{ kind: 'you' | 'claude'; text: string }>>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      await sodium.ready;
      const url = new URL(window.location.href);
      const p = url.searchParams.get('p');
      if (p) {
        try {
          const json = sodium.to_string(
            sodium.from_base64(p, sodium.base64_variants.URLSAFE_NO_PADDING),
          );
          const qr = JSON.parse(json) as QrPayload;
          const s = await completePairing(qr);
          savePaired(s);
          setPaired(s);
          history.replaceState({}, '', '/');
          return;
        } catch (err) {
          setStatus('pairing payload invalid: ' + (err as Error).message);
          return;
        }
      }
      const stored = loadPaired();
      setPaired(stored);
      if (!stored) {
        setStatus(
          'not paired — run `mw-claude pair --relay-url wss://…/api/ws` on your PC and open the URL it prints',
        );
      }
    })();
  }, []);

  useEffect(() => {
    if (!paired) return;
    let backoff = 500;
    let stopped = false;
    let ws: WebSocket | null = null;
    const myPriv = sodium.from_base64(paired.clientPriv, sodium.base64_variants.ORIGINAL);
    const daemonPub = sodium.from_base64(paired.daemonPub, sodium.base64_variants.ORIGINAL);

    function decrypt(b64: string): string {
      const raw = sodium.from_base64(b64, sodium.base64_variants.ORIGINAL);
      const nonce = raw.subarray(0, sodium.crypto_box_NONCEBYTES);
      const ct = raw.subarray(sodium.crypto_box_NONCEBYTES);
      const pt = sodium.crypto_box_open_easy(ct, nonce, daemonPub, myPriv);
      return sodium.to_string(pt);
    }

    function connect() {
      if (stopped) return;
      const url = `${paired!.relayUrl}?channel=${encodeURIComponent(paired!.channelId)}&role=client`;
      ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        backoff = 500;
        setStatus('connected — sending hello');
        ws!.send(JSON.stringify({ type: 'hello', client_pub: paired!.clientPub }));
      };
      ws.onmessage = (e) => {
        let f: { type?: string; ct?: string };
        try { f = JSON.parse(String(e.data)); } catch { return; }
        if (f.type === 'hello_ack') {
          setStatus('paired & encrypted');
        } else if (f.type === 'peer_disconnect') {
          setStatus('daemon disconnected (waiting…)');
        } else if (f.type === 'msg' && f.ct) {
          try {
            const pt = decrypt(f.ct);
            const m = JSON.parse(pt);
            setStatus('paired & encrypted');
            if (m.type === 'reply') setLog((l) => [...l, { kind: 'claude', text: m.text }]);
          } catch {}
        }
      };
      ws.onclose = () => {
        setStatus(`disconnected — reconnecting in ${Math.round(backoff / 1000)}s`);
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 10000);
      };
      ws.onerror = () => { try { ws?.close(); } catch {} };
    }
    connect();

    return () => {
      stopped = true;
      ws?.close();
    };
  }, [paired]);

  function send(text: string) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !paired) return;
    const daemonPub = sodium.from_base64(paired.daemonPub, sodium.base64_variants.ORIGINAL);
    const myPriv = sodium.from_base64(paired.clientPriv, sodium.base64_variants.ORIGINAL);
    const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
    const pt = sodium.from_string(JSON.stringify({ type: 'prompt', text }));
    const ct = sodium.crypto_box_easy(pt, nonce, daemonPub, myPriv);
    const out = new Uint8Array(nonce.length + ct.length);
    out.set(nonce, 0);
    out.set(ct, nonce.length);
    wsRef.current.send(
      JSON.stringify({ type: 'msg', ct: sodium.to_base64(out, sodium.base64_variants.ORIGINAL) }),
    );
    setLog((l) => [...l, { kind: 'you', text }]);
  }

  return (
    <main style={{ maxWidth: 900, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Claude Display</h1>
      <div style={{ fontSize: '0.85rem', color: '#7a8597' }}>{status}</div>
      <div
        style={{
          whiteSpace: 'pre-wrap',
          border: '1px solid #2a2f36',
          padding: '1rem',
          borderRadius: 8,
          minHeight: 300,
          maxHeight: '60vh',
          overflow: 'auto',
          background: '#10141a',
          marginTop: '1rem',
        }}
      >
        {log.map((l, i) => (
          <div
            key={i}
            style={{ color: l.kind === 'you' ? '#9ad0ff' : '#e7e7e7', marginTop: '0.5rem' }}
          >
            {l.kind}: {l.text}
          </div>
        ))}
      </div>
      <form
        style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}
        onSubmit={(e) => {
          e.preventDefault();
          const v = inputRef.current?.value.trim();
          if (v) {
            send(v);
            if (inputRef.current) inputRef.current.value = '';
          }
        }}
      >
        <input
          ref={inputRef}
          placeholder="Type a prompt for Claude Code…"
          style={{
            flex: 1,
            padding: '0.6rem',
            borderRadius: 6,
            border: '1px solid #2a2f36',
            background: '#10141a',
            color: '#e7e7e7',
            fontFamily: 'inherit',
          }}
        />
        <button
          type="submit"
          style={{
            padding: '0.6rem 1rem',
            borderRadius: 6,
            border: 0,
            background: '#3a7afe',
            color: 'white',
          }}
        >
          Send
        </button>
      </form>
      {paired && (
        <button
          onClick={() => {
            localStorage.removeItem(STORAGE_KEY);
            location.reload();
          }}
          style={{
            marginTop: '1rem',
            fontSize: '0.75rem',
            color: '#7a8597',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          unpair this browser
        </button>
      )}
    </main>
  );
}
