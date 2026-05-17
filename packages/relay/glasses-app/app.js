import { consumeUrlPairing } from './pairing.js';
import { connect } from './relay-ws.js';

const els = {
  status: document.getElementById('status-text'),
  talkBtn: document.getElementById('talk-btn'),
  talkBtnLabel: document.getElementById('talk-btn-label'),
  sendBtn: document.getElementById('send-btn'),
  sendBtnLabel: document.getElementById('send-btn-label'),
  draft: document.getElementById('draft'),
  transcript: document.getElementById('transcript'),
  screenMain: document.getElementById('screen-main'),
  screenNotPaired: document.getElementById('screen-not-paired'),
};

const state = {
  paired: null,
  relay: null,
  recording: false,
  pendingDraft: null,   // string, or null
  focusables: [],
  focusIndex: 0,
};

function setStatus(text) {
  els.status.textContent = text;
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

function appendTurn(kind, text) {
  const div = document.createElement('div');
  div.className = `turn turn-${kind}`;
  const label = document.createElement('span');
  label.className = 'turn-label';
  label.textContent = kind === 'you' ? 'you' : 'claude';
  const body = document.createElement('div');
  body.textContent = text;
  div.appendChild(label);
  div.appendChild(body);
  els.transcript.appendChild(div);
  els.transcript.scrollTop = els.transcript.scrollHeight;
}

function setRecording(on, label) {
  state.recording = on;
  els.talkBtn.classList.toggle('recording', on);
  els.talkBtnLabel.textContent = label ?? (on ? 'Waiting for phone to listen…' : (state.pendingDraft ? 'Re-record' : 'Tap to talk'));
}

function setDraft(text) {
  state.pendingDraft = text;
  if (text == null) {
    els.draft.classList.add('hidden');
    els.draft.textContent = '';
    els.sendBtn.classList.add('hidden');
  } else {
    els.draft.classList.remove('hidden');
    els.draft.innerHTML = '';
    const label = document.createElement('span');
    label.className = 'draft-label';
    label.textContent = 'draft';
    const body = document.createElement('div');
    body.textContent = text;
    els.draft.appendChild(label);
    els.draft.appendChild(body);
    els.sendBtn.classList.remove('hidden');
  }
  rebuildFocusables();
}

// D-pad focus order. Only interactive elements — transcript is read-only and
// excluded. When a draft is pending, Send is included and gets default focus.
function rebuildFocusables() {
  const list = [els.talkBtn];
  if (state.pendingDraft != null) list.push(els.sendBtn);
  state.focusables = list;
  if (state.pendingDraft != null) {
    state.focusIndex = list.indexOf(els.sendBtn);
  } else {
    state.focusIndex = Math.min(state.focusIndex, list.length - 1);
  }
  applyFocus();
}

function applyFocus() {
  state.focusables.forEach((el, i) => {
    el.classList.toggle('focused', i === state.focusIndex);
  });
  // Defer the .focus() call so it lands after the current event loop / DOM
  // updates. Without this, the very first focus on page load can miss if
  // the document isn't fully ready, and the Display's EMG tap goes to
  // nowhere — requiring a second tap to activate.
  const target = state.focusables[state.focusIndex];
  if (target) {
    requestAnimationFrame(() => target.focus());
  }
}

function moveFocus(delta) {
  const next = (state.focusIndex + delta + state.focusables.length) % state.focusables.length;
  state.focusIndex = next;
  applyFocus();
}

document.addEventListener('keydown', (e) => {
  if (state.focusables.length === 0) return;
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
    e.preventDefault();
    moveFocus(-1);
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
    e.preventDefault();
    moveFocus(1);
  } else if (e.key === 'Enter' || e.key === ' ') {
    const active = state.focusables[state.focusIndex];
    if (active === els.talkBtn) {
      e.preventDefault();
      handleTalkPress();
    } else if (active === els.sendBtn) {
      e.preventDefault();
      handleSendPress();
    }
  } else if (e.key === 'Escape' || e.key === 'Backspace') {
    state.focusIndex = 0;
    applyFocus();
  }
});

els.talkBtn.addEventListener('click', handleTalkPress);
els.sendBtn.addEventListener('click', handleSendPress);

// Tap-to-talk: send a trigger_record to the phone. If there's already a draft
// pending, the new transcription will overwrite it (the phone sends a fresh
// draft on completion).
//
// Watchdog: if the phone doesn't respond within 15s (no msg comes back via
// the relay), the UI resets so the user can try again without restarting.
let watchdogTimer = null;
function handleTalkPress() {
  if (!state.relay) {
    setStatus('not connected');
    return;
  }
  if (state.recording) return;
  state.relay.send({ type: 'trigger_record' });
  setRecording(true);
  if (watchdogTimer) clearTimeout(watchdogTimer);
  watchdogTimer = setTimeout(() => {
    if (state.recording) {
      setRecording(false);
      setStatus('phone did not respond — tap again');
    }
  }, 15000);
}

function clearWatchdog() {
  if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
}

// Send the pending draft as a real prompt → daemon types it into Claude.
function handleSendPress() {
  const text = state.pendingDraft;
  if (!text || !state.relay) return;
  state.relay.send({ type: 'prompt', text });
  appendTurn('you', text);
  setDraft(null);
  // After sending, refocus the talk button so the next EMG tap starts a new draft.
  state.focusIndex = state.focusables.indexOf(els.talkBtn);
  applyFocus();
  setRecording(false);
}

// Boot.
(async () => {
  setStatus('initializing…');
  const paired = await consumeUrlPairing();
  if (!paired || paired.error) {
    showScreen('screen-not-paired');
    setStatus(paired?.error ?? 'not paired');
    return;
  }
  state.paired = paired;
  showScreen('screen-main');
  rebuildFocusables();

  state.relay = connect({
    paired,
    onStatus: (text) => {
      setStatus(text);
      // If the relay dropped, reset any active recording so the UI isn't stuck.
      if (text.startsWith('disconnected') && state.recording) {
        clearWatchdog();
        setRecording(false);
      }
    },
    onMessage: (obj) => {
      // Any decrypted msg from a peer means the round-trip is happening.
      clearWatchdog();
      if (obj.type === 'phone_state' && obj.state === 'listening') {
        // Phone is now actively recording — keep the recording UI on but
        // change the label so the user knows to start speaking.
        if (!state.recording) setRecording(true);
        els.talkBtnLabel.textContent = 'Speak now';
        return;
      }
      if (state.recording) setRecording(false);
      if (obj.type === 'draft' && typeof obj.text === 'string') {
        // Phone finished transcribing — show the text for confirmation.
        setDraft(obj.text);
      } else if (obj.type === 'prompt' && typeof obj.text === 'string') {
        // Another peer (e.g. the phone in legacy mode, or a laptop client)
        // sent a prompt directly — mirror it into the transcript.
        appendTurn('you', obj.text);
      } else if (obj.type === 'reply' && typeof obj.text === 'string') {
        appendTurn('claude', obj.text);
      }
    },
  });
})();
