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

  // Label + vehicle defaults
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
        statusEl.textContent = 'Arrived';
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
      statusEl.textContent = reason ? `Paused — ${reason}` : 'Paused';
      renderETA();
      if (autoResumeTimer) clearTimeout(autoResumeTimer);
      if (minutes && minutes>0){
        autoResumeTimer = setTimeout(()=>setPaused(false), minutes*60*1000);
      }
    } else {
      document.body.classList.remove('paused');
      statusEl.textContent = `${fromLabel} → ${toLabel}`;
      renderETA();
      if (countdownSec>0 && !tickTimer) startTick();
    }
  }

  // ✅ ANIMATION-AWARE vehicle display (RV / plane)
  function applyVehicleView(){
    const isPlane =
      (vehicleMode === 'emoji' && /✈/.test(vehicleEmoji)) ||
      (vehicleMode === 'image' && /plane\.png$/i.test(vehicleImage));

    if (miniEmoji) {
      miniEmoji.classList.toggle('is-plane', isPlane);
      miniEmoji.classList.toggle('is-rv', !isPlane);
    }
    if (miniIcon) {
      miniIcon.classList.toggle('is-plane', isPlane);
      miniIcon.classList.toggle('is-rv', !isPlane);
    }

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
  }

  // ===== MESSAGE API =====
  window.addEventListener('message', (event) => {
    const msg = event.data || {};

    // labels & manual vehicle update
    if (msg.type === 'rv:update'){
      if (typeof msg.rv === 'string') { vehicleMode = 'image'; vehicleImage = msg.rv; }
      if (typeof msg.from === 'string') fromLabel = msg.from;
      if (typeof msg.to === 'string')   toLabel   = msg.to;
      updateLabels(); renderETA(); applyVehicleView();
      return;
    }

    // MANUAL TIMER
    if (msg.type === 'eta:setCountdown'){
      const h = Math.max(0, Number(msg.hours||0));
      const m = Math.max(0, Math.min(59, Number(msg.minutes||0)));
      baselineSec = (h*3600) + (m*60);
      countdownSec = baselineSec;
      statusEl.textContent = `${fromLabel} → ${toLabel}`;
      setProgressByTimer(); renderETA();
      if (!paused) startTick();
      return;
    }

    if (msg.type === 'eta:addMinutes'){
      const delta = Number(msg.minutes||0)*60;
      countdownSec = Math.max(0, countdownSec + delta);
      baselineSec  = Math.max(0, baselineSec + delta);
      setProgressByTimer(); renderETA();
      if (!paused && countdownSec>0 && !tickTimer) startTick();
      if (countdownSec===0) stopTick();
      return;
    }

    if (msg.type === 'eta:resetCountdown'){
      countdownSec = baselineSec;
      setProgressByTimer(); renderETA();
      if (!paused && countdownSec>0 && !tickTimer) startTick();
      if (countdownSec===0) stopTick();
      return;
    }

    if (msg.type === 'eta:stop'){
      baselineSec=0; countdownSec=0;
      stopTick(); setProgressByTimer(); renderETA();
      return;
    }

    // PAUSE/RESUME
    if (msg.type === 'rv:pause')       return void setPaused(true, msg.reason||'', msg.minutes||null);
    if (msg.type === 'rv:resume')      return void setPaused(false);
    if (msg.type === 'rv:togglePause') return void setPaused(!paused, msg.reason||'');

    // VEHICLE SELECTION
    if (msg.type === 'vehicle:select'){
      const preset = (msg.preset||'rv').toLowerCase();
      const mode   = (msg.mode||'emoji').toLowerCase();

      if (mode==='emoji'){
        vehicleMode='emoji';
        vehicleEmoji = preset==='plane' ? '✈️' : '🚐';
      } else {
        vehicleMode='image';
        vehicleImage = preset==='plane' ? 'assets/plane.png' : 'assets/rv.png';
      }
      applyVehicleView();
      return;
    }

    if (msg.type === 'vehicle:emoji'){
      if (typeof msg.char==='string' && msg.char.trim()){
        vehicleMode='emoji';
        vehicleEmoji=msg.char.trim();
        applyVehicleView();
      }
      return;
    }

    if (msg.type === 'vehicle:image'){
      if (typeof msg.url==='string' && msg.url.trim()){
        vehicleMode='image';
        vehicleImage=msg.url.trim();
        applyVehicleView();
      }
      return;
    }
  });

  // init
  updateLabels();
  renderETA();
  setProgressByTimer();
  applyVehicleView();
})();
