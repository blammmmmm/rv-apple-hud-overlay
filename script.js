/* v10 – progress-synced + chill subtext */
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
  let vehicleMode  = 'emoji';           // 'emoji' | 'image'
  let vehicleEmoji = '🚐';
  let vehicleImage = qs('rv','assets/rv.png');

  // Manual timer state
  let paused        = false;
  let countdownSec  = 0;
  let baselineSec   = 0;
  let tickTimer     = null;
  let autoResumeTimer = null;
  let progressPct   = 0; // 0..1

  // --- optional debug HUD (enable with ?debug=1) ---
  const debugOn = qs('debug', null) === '1';
  let debugBox = null;
  function debugRender() {
    if (!debugOn) return;
    if (!debugBox) {
      debugBox = document.createElement('div');
      debugBox.style.cssText = 'position:fixed;left:10px;bottom:10px;background:rgba(0,0,0,.65);color:#fff;padding:6px 8px;border-radius:8px;font:12px/1.2 ui-sans-serif,-apple-system,Segoe UI,Roboto;z-index:99999';
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

  // Helper: are we in plane mode?
  function _isPlane() {
    return (
      (vehicleMode === 'emoji' && /✈/.test(vehicleEmoji)) ||
      (vehicleMode === 'image' && /plane\.png$/i.test(vehicleImage))
    );
  }

  // CHILL, progress-aware subtext + ETA text
  function renderETA(){
    if (paused){
      etaEl.textContent = 'ETA paused';
      statusEl.classList.add('paused');
      statusEl.textContent = 'paused' + (statusEl.textContent.includes('—') ? '' : '');
      debugRender();
      return;
    }

    statusEl.classList.remove('paused');

    // ETA readout
    if (countdownSec > 0){
      etaEl.textContent = `ETA ${fmtHMS(countdownSec)}`;
    } else if (baselineSec > 0){
      etaEl.textContent = 'ETA 0m';
    } else {
      etaEl.textContent = 'ETA --:--';
    }

    // Subtext logic (Option C, lowercase, 10-min window)
    let sub = 'preparing…'; // default before timer is set
    if (baselineSec > 0) {
      if (countdownSec <= 0) {
        sub = 'arrived';
      } else if (countdownSec <= 10 * 60) {
        sub = 'arriving soon…';
      } else {
        sub = _isPlane() ? 'in flight…' : 'en route…';
      }
    }
    statusEl.textContent = sub;

    debugRender();
  }

  function applyVehicleView(){
    const isPlane =
      (vehicleMode === 'emoji' && /✈/.test(vehicleEmoji)) ||
      (vehicleMode === 'image' && /plane\.png$/i.test(vehicleImage));

    const leftPct = (progressPct * 100) + '%';

    if (vehicleMode === 'emoji') {
      if (miniEmoji){
        miniEmoji.textContent = vehicleEmoji;
        miniEmoji.style.display = 'block';
        miniEmoji.style.left = leftPct;
      }
      if (miniIcon) miniIcon.style.display = 'none';
    } else {
      if (miniIcon){
        miniIcon.src = vehicleImage;
        miniIcon.style.display = 'block';
        miniIcon.style.left = leftPct;
      }
      if (miniEmoji) miniEmoji.style.display = 'none';
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
    if (laneProg) laneProg.style.width = (progressPct*100) + '%';
    applyVehicleView();
    debugRender();
  }

  function startTick(){
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      if (paused) return;
      if (countdownSec > 0){
        countdownSec -= 1;
        setProgressByTimer();
        renderETA();
      } else if (baselineSec > 0){
        clearInterval(tickTimer);
        tickTimer = null;
        setProgressByTimer(); // snap to 100%
        // no manual status override; renderETA() shows "arrived"
        renderETA();
      }
    }, 1000);
  }

  function stopTick(){
    if (tickTimer){
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  function setPaused(p, reason='', minutes=null){
    paused = !!p;
    if (paused){
      document.body.classList.add('paused');
      statusEl.textContent = reason ? `paused — ${reason}` : 'paused';
      renderETA();
      if (autoResumeTimer) clearTimeout(autoResumeTimer);
      if (minutes && minutes>0){
        autoResumeTimer = setTimeout(()=>setPaused(false), minutes*60*1000);
      }
    } else {
      document.body.classList.remove('paused');
      // keep subtext logic centralized in renderETA()
      renderETA();
      if (countdownSec>0 && !tickTimer) startTick();
    }
  }

  // ===== MESSAGE API =====
  let gotAnyMessage = false; // for failsafe auto-demo
  window.addEventListener('message', (event) => {
    const msg = event.data || {};
    gotAnyMessage = true;

    if (msg.type === 'rv:update'){
      if (typeof msg.rv === 'string') { vehicleMode = 'image'; vehicleImage = msg.rv; }
      if (typeof msg.from === 'string') fromLabel = msg.from;
      if (typeof msg.to === 'string')   toLabel   = msg.to;
      updateLabels(); renderETA(); applyVehicleView();
      return;
    }

    // Manual timer controls
    if (msg.type === 'eta:setCountdown'){
      const h = Math.max(0, Number(msg.hours||0));
      const m = Math.max(0, Math.min(59, Number(msg.minutes||0)));
      baselineSec = (h*3600) + (m*60);
      countdownSec = baselineSec;
      setProgressByTimer(); renderETA();
      if (!paused) startTick();
      return;
    }

    if (msg.type === 'eta:addMinutes'){
      const delta = Number(msg.minutes||0) * 60;
      countdownSec = Math.max(0, countdownSec + delta);
      baselineSec  = Math.max(0, baselineSec + delta);
      setProgressByTimer(); renderETA();
      if (!paused && countdownSec>0 && !tickTimer) startTick();
      if (countdownSec === 0) stopTick();
      return;
    }

    if (msg.type === 'eta:resetCountdown'){
      countdownSec = baselineSec;
      setProgressByTimer(); renderETA();
      if (!paused && countdownSec>0 && !tickTimer) startTick();
      if (countdownSec === 0) stopTick();
      return;
    }

    if (msg.type === 'eta:stop'){
      baselineSec = 0;
      countdownSec = 0;
      stopTick();
      setProgressByTimer(); renderETA();
      return;
    }

    // Pause / Resume
    if (msg.type === 'rv:pause')       return void setPaused(true,  msg.reason || '', msg.minutes || null);
    if (msg.type === 'rv:resume')      return void setPaused(false);
    if (msg.type === 'rv:togglePause') return void setPaused(!paused, msg.reason || '');

    // Vehicle selection
    if (msg.type === 'vehicle:select'){
      const preset = (msg.preset || 'rv').toLowerCase();
      const mode   = (msg.mode || 'emoji').toLowerCase();
      if (mode === 'emoji'){
        vehicleMode = 'emoji';
        vehicleEmoji = (preset === 'plane') ? '✈️' : '🚐';
      } else {
        vehicleMode = 'image';
        vehicleImage = (preset === 'plane') ? 'assets/plane.png' : 'assets/rv.png';
      }
      applyVehicleView();
      renderETA(); // updates subtext to in flight… / en route…
      return;
    }
    if (msg.type === 'vehicle:emoji'){
      if (typeof msg.char === 'string' && msg.char.trim()){
        vehicleMode = 'emoji';
        vehicleEmoji = msg.char.trim();
        applyVehicleView();
        renderETA();
      }
      return;
    }
    if (msg.type === 'vehicle:image'){
      if (typeof msg.url === 'string' && msg.url.trim()){
        vehicleMode = 'image';
        vehicleImage = msg.url.trim();
        applyVehicleView();
        renderETA();
      }
      return;
    }
  });

  // ===== INIT =====
  updateLabels();
  renderETA();
  setProgressByTimer();
  applyVehicleView();

  // URL-based demo (explicit)
  const demoSec = Number(qs('demoSec', 0));
  const demoMin = Number(qs('demoMin', 0));
  const autoStartSec = Number.isFinite(demoSec) && demoSec > 0
    ? Math.floor(demoSec)
    : (Number.isFinite(demoMin) && demoMin > 0 ? Math.floor(demoMin*60) : 0);
  if (autoStartSec > 0) {
    baselineSec = autoStartSec;
    countdownSec = autoStartSec;
    setProgressByTimer(); renderETA();
    if (!paused) startTick();
  }

  // Failsafe demo: if no message arrives within 2s and no URL demo, auto-run 20s
  setTimeout(() => {
    if (!gotAnyMessage && baselineSec === 0) {
      baselineSec = 20; // 20s demo to prove motion
      countdownSec = 20;
      setProgressByTimer(); renderETA();
      if (!paused) startTick();
    }
  }, 2000);
})();
