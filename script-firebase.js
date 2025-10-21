/* Overlay (Firebase) — persistent state, OBS-safe, 10s "departing…" */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";

/* ---------- ROOM ---------- */
const ROOM = new URLSearchParams(location.search).get('room') || 'marathon-pill-tracker';

/* ---------- FIREBASE CONFIG (injected) ---------- */
const firebaseConfig = {
  apiKey: "AIzaSyB0gJnv1eD4SeXMCRHtFNiHOt122Rbz4XQ",
  authDomain: "subathon-tracker.firebaseapp.com",
  databaseURL: "https://subathon-tracker-default-rtdb.firebaseio.com",
  projectId: "subathon-tracker",
  storageBucket: "subathon-tracker.appspot.com",
  messagingSenderId: "196475311335",
  appId: "1:196475311335:web:ac4411584ea074613ffe42",
  measurementId: "G-ETY652FL4L"
};
/* ----------------------------------------------- */

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);
const stateRef = ref(db, `overlays/${ROOM}/state`);

// DOM
const fromEl    = document.getElementById('fromState');
const toEl      = document.getElementById('toState');
const etaEl     = document.getElementById('eta');
const statusEl  = document.getElementById('status');
const laneProg  = document.getElementById('laneProgress');
const miniIcon  = document.getElementById('miniIcon');
const miniEmoji = document.getElementById('miniEmoji');

let ui = {
  from: '—', to: '—',
  vehicle: { mode:'image', emoji:'🚐', image:'assets/rv.png' },
  baselineSec: 0,
  startedAt: 0,       // epoch ms when timer was set
  endAt: 0,           // epoch ms when ETA should be done (unless paused)
  paused: false,
  pausedAt: 0,        // ms when paused began
  pausedRemaining: 0, // ms remaining at pause time
  updatedAt: 0
};

const DEPART_MS = 10_000;           // 10s departing window
const ARRIVE_WIN_SEC = 10*60;       // "arriving soon…" under 10m
let tickTimer = null;
let currentSub = '';

function setText(el, t){ if (el && el.textContent !== t) el.textContent = t; }
function setStatus(t){
  if (currentSub === t) return;
  currentSub = t;
  statusEl.classList.add('is-fading');
  setTimeout(()=>{ setText(statusEl, t); statusEl.classList.toggle('paused', t.startsWith('paused')); requestAnimationFrame(()=>statusEl.classList.remove('is-fading')); }, 120);
}
function isPlane(){
  return (ui.vehicle.mode==='emoji' && /✈/.test(ui.vehicle.emoji)) ||
         (ui.vehicle.mode==='image' && /plane\.png$/i.test(ui.vehicle.image));
}
function renderVehicle(leftPct){
  if (ui.vehicle.mode==='emoji'){
    document.body.classList.add('emoji-mode');
    miniEmoji.style.left = leftPct;
    miniEmoji.textContent = ui.vehicle.emoji || '🚐';
    miniIcon.style.display='none'; miniIcon.removeAttribute('src');
  } else {
    document.body.classList.remove('emoji-mode');
    miniIcon.style.left = leftPct;
    const src = ui.vehicle.image || 'assets/rv.png';
    const next = src + (src.includes('?') ? '&v=1' : '?v=1');
    if (miniIcon.getAttribute('src') !== next) miniIcon.src = next;
    miniEmoji.textContent='';
  }
  miniEmoji.classList.toggle('is-plane', isPlane());
  miniIcon.classList.toggle('is-plane', isPlane());
}

function fmtRemaining(remainingSec){
  const h = Math.floor(remainingSec/3600);
  const m = Math.floor((remainingSec%3600)/60);
  return h>0 ? `${h}h ${m}m` : `${m}m`;
}

function tick(){
  const now = Date.now();
  let remainingMs;

  if (ui.baselineSec <= 0 || ui.startedAt <= 0){
    remainingMs = 0;
  } else if (ui.paused){
    remainingMs = Math.max(0, ui.pausedRemaining || 0);
  } else {
    remainingMs = Math.max(0, ui.endAt - now);
  }

  const remainingSec = Math.floor(remainingMs/1000);
  const progress = (ui.baselineSec>0)
    ? Math.min(1, (ui.baselineSec*1000 - remainingMs) / (ui.baselineSec*1000))
    : 0;

  // ETA line
  if (ui.paused){
    setText(etaEl, 'ETA paused');
  } else if (ui.baselineSec > 0){
    setText(etaEl, `ETA ${fmtRemaining(remainingSec)}`);
  } else {
    setText(etaEl, 'ETA --:--');
  }

  // Subtext
  if (ui.paused){
    setStatus('paused');
    document.body.classList.add('paused');
  } else {
    document.body.classList.remove('paused');
    if (ui.baselineSec>0 && remainingSec<=0) {
      setStatus('arrived');
    } else if (ui.baselineSec>0) {
      const sinceStart = now - ui.startedAt;
      if (sinceStart < DEPART_MS) setStatus('departing…');
      else if (remainingSec <= ARRIVE_WIN_SEC) setStatus('arriving soon…');
      else setStatus(isPlane() ? 'in flight…' : 'en route…');
    } else {
      setStatus('preparing…');
    }
  }

  // Labels and progress
  setText(fromEl, ui.from || '—');
  setText(toEl, ui.to || '—');
  laneProg.style.width = (progress*100).toFixed(2) + '%';
  renderVehicle((progress*100).toFixed(2) + '%');
}

onValue(stateRef, (snap) => {
  const v = snap.val();
  if (!v){ return; }
  ui = { ...ui, ...v };
  if (!tickTimer){
    tickTimer = setInterval(tick, 1000);
  }
  tick(); // immediate
});

// Safety: hide the old big RV
const legacy = document.getElementById('rv');
if (legacy) legacy.style.display = 'none';
