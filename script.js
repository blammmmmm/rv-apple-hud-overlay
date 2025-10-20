/* v9-cachebust */
(() => {
  const qs = (k, d=null) => new URLSearchParams(location.search).get(k) ?? d;

  // DOM
  const fromEl    = document.getElementById('fromState');
  const toEl      = document.getElementById('toState');
  const etaEl     = document.getElementById('eta');
  const statusEl  = document.getElementById('status');
  const miniIcon  = document.getElementById('miniIcon');
  const miniEmoji = document.getElementById('miniEmoji');
  const laneProg  = document.getElementById('laneProgress');

  // Labels & vehicle defaults
  let fromLabel    = qs('from','—');
  let toLabel      = qs('to','—');
  let vehicleMode  = 'emoji';
  let vehicleEmoji = '🚐';
  let vehicleImage = qs('rv','assets/rv.png');

  // Manual timer state
  let paused        = false;
  let countdownSec  = 0;
  let baselineSec   = 0;
  let tickTimer     = null;
  let autoResumeTimer = null;
  let progressPct   = 0; // 0..1

  // Debug HUD
  const debugOn = qs('debug', null) === '1';
  let debugBox = null;
  function debugRender() {
    if (!debugOn) return;
    if (!debugBox) {
      debugBox = document.createElement('div');
      debugBox.style.cssText = 'position:fixed;left:10px;bottom:10px;background:rgba(0,0,0,.65);color:#fff;padding:6px 8px;border-radius:8px;font:12px ui-sans-serif,z-index:99999';
      document.body.appendChild(debugBox);
    }
    debugBox.textContent = `baselineSec=${baselineSec}  countdownSec=${countdownSec}  progress=${(progressPct*100).toFixed(1)}%`;
  }

  function updateLabels(){
    fromEl.textContent = fromLabel;
    toEl.textContent   = toLabel;
  }

  function fmtHMS(sec){
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec/3600);
    const m = Math.floor((sec%3600)/60);
    return h>0 ? `${h}h ${m}m` : `${m}m`;
  }

  function renderETA(){
    if (paused){
      etaEl.textContent = 'ETA paused';
      statusEl.classList.add('paused');
    } else {
      statusEl.classList.remove('paused');
      if (countdownSec > 0){
        etaEl.textContent = `ETA ${fmtHMS(countdownSec)}`;
      } else if (baselineSec > 0){
        etaEl.textContent = 'ETA 0m';
        statusEl.textContent = 'Arrived';
      } else {
        etaEl.textContent = 'ETA --:--';
      }
    }
    debugRender();
  }

  function applyVehicleView(){
    const isPlane =
      (vehicleMode === 'emoji' && /✈/.test(vehicleEmoji)) ||
      (vehicleMode === 'image' && /plane\.png$/i.test(vehicleImage));

    const leftPct = (progressPct * 100) + '%';

    if (vehicleMode === 'emoji') {
      miniEmoji.textContent = vehicleEmoji;
      miniEmoji.style.display = 'block';
      miniEmoji.style.left = leftPct;
      miniIcon.style.display = 'none';
    } else {
      miniIcon.src = vehicleImage;
      miniIcon.style.display = 'block';
      miniIcon.style.left = leftPct;
      miniEmoji.style.display = 'none';
    }

    miniEmoji?.classList.toggle('is-plane', isPlane);
    miniIcon?.classList.toggle('is-plane', isPlane);
  }

  function setProgressByTimer(){
    if (baselineSec <= 0){
      progressPct = 0;
    } else {
      const done = Math.max(0, baselineSec - countdownSec);
      progressPct = Math.min(1, done / baselineSec);
    }
    laneProg.style.width = (progressPct * 100) + '%';
    applyVehicleView();
    debugRender();
  }

  function startTick(){
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      if (!paused && countdownSec > 0) {
        countdownSec -= 1;
        setProgressByTimer();
        renderETA();
      } else if (baselineSec > 0 && countdownSec <= 0) {
        clearInterval(tickTimer);
        tickTimer = null;
        setProgressByTimer();
        statusEl.textContent = 'Arrived';
        renderETA();
      }
    }, 1000);
  }

  function stopTick(){
    clearInterval(tickTimer);
    tickTimer = null;
  }

  function setPaused(p, reason='', minutes=null){
    paused = !!p;
    if (paused){
      document.body.classList.add('paused');
      statusEl.textContent = reason || 'Paused';
    } else {
      document.body.classList.remove('paused');
      statusEl.textContent = `${fromLabel} → ${toLabel}`;
      if (countdownSec>0 && !tickTimer) startTick();
    }
    renderETA();
  }

  // ===== MESSAGE API =====
  let gotAnyMessage = false;
  window.addEventListener('message', (event) => {
    const msg = event.data || {};
    gotAnyMessage = true;

    if (msg.type === 'rv:update'){
      if (msg.rv) { vehicleMode = 'image'; vehicleImage = msg.rv; }
      if (msg.from) fromLabel = msg.from;
      if (msg.to)   toLabel   = msg.to;
      updateLabels(); renderETA(); applyVehicleView();
      return;
    }

    if (msg.type === 'eta:setCountdown'){
      const h = Number(msg.hours||0);
      const m = Number(msg.minutes||0);
      baselineSec = (h*3600) + (m*60);
      countdownSec = baselineSec;
      setProgressByTimer(); renderETA();
      if (!paused) startTick();
      return;
    }

    if (msg.type === 'eta:addMinutes'){
      const delta = Number(msg.minutes||0)*60;
      countdownSec = Math.max(0, countdownSec + delta);
      baselineSec  = Math.max(0, baselineSec + delta);
      setProgressByTimer(); renderETA();
      return;
    }

    if (msg.type === 'eta:stop'){
      baselineSec = 0;
      countdownSec = 0;
      stopTick();
      setProgressByTimer(); renderETA();
      return;
    }

    if (msg.type === 'rv:pause')       return setPaused(true, msg.reason, msg.minutes);
    if (msg.type === 'rv:resume')      return setPaused(false);
    if (msg.type === 'rv:togglePause') return setPaused(!paused);

    if (msg.type === 'vehicle:select'){
      vehicleMode = msg.mode === 'image' ? 'image' : 'emoji';
      if (msg.mode === 'emoji') vehicleEmoji = msg.preset==='plane' ? '✈️' : '🚐';
      else vehicleImage = msg.preset==='plane' ? 'assets/plane.png' : 'assets/rv.png';
      applyVehicleView();
    }
  });

  // ===== INIT =====
  updateLabels();
  renderETA();
  setProgressByTimer();
  applyVehicleView();

  // URL demo
  const demoSec = Number(qs('demoSec', 0));
  if (demoSec > 0) {
    baselineSec = demoSec;
    countdownSec = demoSec;
    startTick();
  }

  // Failsafe: auto 20s demo if nothing received after 2s
  setTimeout(() => {
    if (!gotAnyMessage && baselineSec === 0) {
      baselineSec = 20;
      countdownSec = 20;
      startTick();
    }
  }, 2000);
})();
