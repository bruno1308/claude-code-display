import { consumeUrlPairing } from './pairing.js';
import { connect } from './relay-ws.js';

const els = {
  status: document.getElementById('status-text'),
  talkBtn: document.getElementById('talk-btn'),
  talkBtnLabel: document.getElementById('talk-btn-label'),
  transcript: document.getElementById('transcript'),
  screenMain: document.getElementById('screen-main'),
  screenNotPaired: document.getElementById('screen-not-paired'),
};

const state = {
  paired: null,
  relay: null,
  recording: false,
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

function setRecording(on) {
  state.recording = on;
  els.talkBtn.classList.toggle('recording', on);
  els.talkBtnLabel.textContent = on ? 'Listening… tap to send' : 'Tap to talk';
}

// D-pad: Up/Down toggles focus between talk button and transcript.
function rebuildFocusables() {
  state.focusables = [els.talkBtn, els.transcript];
  state.focusIndex = 0;
  applyFocus();
}

function applyFocus() {
  state.focusables.forEach((el, i) => {
    el.classList.toggle('focused', i === state.focusIndex);
  });
  state.focusables[state.focusIndex]?.focus();
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
    if (state.focusables[state.focusIndex] === els.talkBtn) {
      e.preventDefault();
      handleTalkPress();
    }
  } else if (e.key === 'Escape' || e.key === 'Backspace') {
    state.focusIndex = 0;
    applyFocus();
  }
});

els.talkBtn.addEventListener('click', handleTalkPress);

function handleTalkPress() {
  if (!state.relay) {
    setStatus('not connected');
    return;
  }
  if (!state.recording) {
    startRecording();
  } else {
    stopRecordingAndSend();
  }
}

// Web Speech API integration with fallback.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let interimText = '';
let finalText = '';

if (SR) {
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = navigator.language || 'en-US';

  recognition.onresult = (event) => {
    interimText = '';
    finalText = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += transcript;
      else interimText += transcript;
    }
    els.talkBtnLabel.textContent = (finalText + interimText).trim() || 'Listening…';
  };

  recognition.onerror = (event) => {
    setStatus('speech error: ' + event.error);
    setRecording(false);
  };

  recognition.onend = () => {
    if (state.recording) {
      stopRecordingAndSend();
    }
  };
}

function startRecording() {
  finalText = '';
  interimText = '';
  setRecording(true);
  if (recognition) {
    try {
      recognition.start();
    } catch (err) {
      setStatus('speech start error: ' + err.message);
      setRecording(false);
    }
  } else {
    setRecording(false);
    const text = (prompt('Type your prompt (speech not supported here):') || '').trim();
    if (text) {
      appendTurn('you', text);
      state.relay.send({ type: 'prompt', text });
    }
  }
}

function stopRecordingAndSend() {
  if (!state.recording) return;
  setRecording(false);
  if (recognition) {
    try { recognition.stop(); } catch {}
  }
  const text = (finalText + interimText).trim();
  els.talkBtnLabel.textContent = 'Tap to talk';
  if (!text) return;
  appendTurn('you', text);
  state.relay.send({ type: 'prompt', text });
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
    onStatus: setStatus,
    onMessage: (obj) => {
      if (obj.type === 'reply' && typeof obj.text === 'string') {
        appendTurn('claude', obj.text);
      }
    },
  });
})();
