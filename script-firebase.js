// script-firebase.js — overlay runtime (FINAL)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";

const qs = (k, d=null) => new URLSearchParams(location.search).get(k) ?? d;
const ROOM = qs('room', 'marathon-pill-tracker');

// Firebase
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
const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);
const stateRef = ref(db, `overlays/${ROOM}/state`);

// HUD DOM
const fromEl   = document.getElementById('fromState');
const toEl     = document.getElementById('toState');
const etaEl    = document.getElementById('eta');
const statusEl = document.getElementById('status');
const laneProg = document.getElementById('laneProgress');
const miniIcon  = document.getElementById('miniIcon');
const miniEmoji = document.getElementById('miniEmoji');

function fmtHMS(sec){
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec%3600)/60);
  return h>0 ? `${h}h ${m}m` : `${m}m`;
}

let lastSnap = {};
let tickHandle = null;

function renderFromState(s){
  fromEl.textContent = s.from || '—';
  toEl.textContent   = s.to   || '—';

  const v = s.vehicle || {};
  const isEmoji = v.mode === 'emoji';
  if (isEmoji){
    miniEmoji.textContent = v.emoji || '🚐';
    miniEmoji.style.display = 'block';
    miniIcon.style.display  = 'none';
  } else {
    miniIcon.src = (v.image || 'assets/bus.png');
    miniIcon.style.display  = 'block';
    miniEmoji.style.display = 'none';
  }
}

function compute() {
  const s = lastSnap;
  const now = Date.now();
  const base = Number(s.baselineSec||0);
  const paused = !!s.paused;

  let remainingMs = 0;
  if (base <= 0){
    remainingMs = 0;
  } else if (paused) {
    remainingMs = Math.max(0, Number(s.pausedRemaining||0));
  } else {
    const endAt = Number(s.endAt||0);
    remainingMs = Math.max(0, endAt - now);
  }

  const remainingSec = Math.floor(remainingMs/1000);
  const done = Math.max(0, base - remainingSec);
  const pct = base>0 ? Math.min(1, done/base) : 0;

  if (base <= 0){
    etaEl.textContent = 'ETA --:--';
    statusEl.textContent = 'ready';
  } else if (remainingSec <= 0){
    etaEl.textContent = 'ETA 0m';
    statusEl.textContent = 'arrived';
  } else if (paused){
    etaEl.textContent = 'ETA paused';
    statusEl.textContent = 'paused';
  } else {
    etaEl.textContent = `ETA ${fmtHMS(remainingSec)}`;
    const plane = (s.vehicle && s.vehicle.mode==='emoji' && (s.vehicle.emoji||'').includes('✈'));
    statusEl.textContent = plane ? 'in flight' : 'en route';
  }

  laneProg.style.width = (pct*100) + '%';
  const left = `calc(${(pct*100)}% - 10px)`;
  if (miniEmoji.style.display === 'block') miniEmoji.style.left = left;
  if (miniIcon.style.display === 'block')  miniIcon.style.left  = left;
}

function startTicker(){
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = setInterval(compute, 1000);
}

onValue(stateRef, (snap) => {
  lastSnap = snap.val() || {};
  renderFromState(lastSnap);
  compute();
  startTicker();
});
