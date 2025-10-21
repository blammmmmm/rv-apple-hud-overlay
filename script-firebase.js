/* Overlay (Firebase) — bus.png for driving, ✈️ emoji for flights, medium size */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";

/* ---------- ROOM ---------- */
const ROOM = new URLSearchParams(location.search).get('room') || 'marathon-pill-tracker';

/* ---------- YOUR FIREBASE CONFIG ---------- */
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
/* ----------------------------------------- */

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);
const stateRef = ref(db, `overlays/${ROOM}/state`);

// DOM
const fromEl    = document.getElementById('fromState');
const toEl      = document.getElementById('toState');
const etaEl     = document.getElementById('eta');
const statusEl  = document.getElementById('status');
const laneProg  = document.getElementById('laneProgress');
const miniIcon  = document.getElementById('miniIcon');   // image (bus)
const miniEmoji = document.getElementById('miniEmoji');  // emoji (plane)

let ui = {
  from: '—', to: '—',
  vehicle: { mode:'image', emoji:'✈️', image:'assets/bus.png' }, // default to bus image available in repo
  baselineSec: 0,
  startedAt: 0,
  endAt: 0,
  paused: false,
  pausedAt: 0,
  pausedRemaining: 0,
  updatedAt: 0
};

const DEPART_MS = 10_000;      // “departing…” for first 10s
const ARRIVE_SOON_SEC = 10*60; // “arriving soon…” under 10m
let tickTimer = null;
let currentStatus = '';

/* ---------- helpers ---------- */
function setText(el, txt){ if (el && el.textContent !== txt) el.textContent = txt; }
function fmtRemaining(s){
  const h = Math.floor(s/3600);
  const m = Math.floor((s%3600)/60);
  return h>0 ? `${h}h ${m}m` : `${m}m`;
}
function setStatus(txt){
  if (currentStatus === txt) return;
  currentStatus = txt;
  statusEl.classList.add('is-fading');
  setTimeout(() => {
    setText(statusEl, txt);
    statusEl.classList.toggle('paused', txt.startsWith('paused'));
    requestAnimationFrame(() => statusEl.classList.remove('is-fading'));
  }, 120);
}
function isPlaneMode(){
  // plane is only ever the emoji mode per your spec
  return ui.vehicle.mode === 'emoji' && /✈/.test(ui.vehicle.emoji || '');
}

/* ---------- vehicle render ---------- */
function renderVehicle(progressPct){
  const leftPct = (progressPct * 100).toFixed(2) + '%';

  if (isPlaneMode()){
    // emoji plane visible
    miniEmoji.style.display = 'block';
    miniEmoji.style.left = leftPct;
    miniEmoji.textContent = ui.vehicle.emoji || '✈️';
    // medium sizing for emoji
    miniEmoji.style.fontSize = '22px';
    // hide image
    miniIcon.style.display = 'none';
    miniIcon.removeAttribute('src');
  } else {
    // image bus visible
    miniIcon.style.display = 'block';
    miniIcon.style.left = leftPct;
    // medium sizing for bus png
    miniIcon.style.width = '28px';
    miniIcon.style.height = 'auto';
    // src with tiny cache-buster
    const src = (ui.vehicle.image || 'assets/bus.png');
    const next = src + (src.includes('?') ? '&v=1' : '?v=1');
    if (miniIcon.getAttribute('src') !== next) miniIcon.src = next;

    // hide emoji
    miniEmoji.style.display = 'none';
    miniEmoji.textContent = '';
  }

  // gentle bob animation via CSS classes
  miniEmoji.classList.toggle('is-plane', isPlaneMode());
  miniIcon.classList.toggle('is-plane', false);
}

/* ---------- main tick ---------- */
function tick(){
  const now = Date.now();

  let remainingMs = 0;
  if (ui.baselineSec > 0 && ui.startedAt > 0){
    if (ui.paused){
      remainingMs = Math.max(0, ui.pausedRemaining || 0);
    } else {
      remainingMs = Math.max(0, ui.endAt - now);
    }
  }
  const remainingSec = Math.floor(remainingMs / 1000);

  // progress
  const totalMs = ui.baselineSec * 1000;
  const doneMs  = Math.min(totalMs, totalMs - remainingMs);
  const progress = (totalMs > 0) ? (doneMs / totalMs) : 0;

  // ETA
  if (ui.paused){
    setText(etaEl, 'ETA paused');
  } else if (ui.baselineSec > 0){
    setText(etaEl, `ETA ${fmtRemaining(remainingSec)}`);
  } else {
    setText(etaEl, 'ETA --:--');
  }

  // status line
  if (ui.paused){
    document.body.classList.add('paused');
    setStatus('paused');
  } else {
    document.body.classList.remove('paused');
    if (ui.baselineSec>0 && remainingSec<=0){
      setStatus('arrived');
    } else if (ui.baselineSec>0){
      const sinceStart = now - ui.startedAt;
      if (sinceStart < DEPART_MS) setStatus('departing…');
      else if (remainingSec <= ARRIVE_SOON_SEC) setStatus('arriving soon…');
      else setStatus(isPlaneMode() ? 'in flight…' : 'en route…');
    } else {
      setStatus('preparing…');
    }
  }

  // labels + visuals
  setText(fromEl, ui.from || '—');
  setText(toEl, ui.to || '—');
  laneProg.style.width = (progress * 100).toFixed(2) + '%';
  renderVehicle(progress);
}

/* ---------- Firebase listener ---------- */
onValue(stateRef, (snap) => {
  const v = snap.val();
  if (!v) return;
  ui = { ...ui, ...v };

  // ensure vehicle defaults always valid
  if (!ui.vehicle) ui.vehicle = { mode:'image', emoji:'✈️', image:'assets/bus.png' };
  if (ui.vehicle.mode !== 'emoji' && !ui.vehicle.image) ui.vehicle.image = 'assets/bus.png';

  if (!tickTimer){
    tickTimer = setInterval(tick, 1000);
  }
  tick(); // immediate update
});

/* ---------- safety: hide legacy big RV if present ---------- */
const legacy = document.getElementById('rv');
if (legacy) legacy.style.display = 'none';
