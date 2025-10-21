/* v13 – OBS bridge + 10s departing window + subtext words only + crossfade */
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

  /* ---- UNIVERSAL BRIDGES (accept commands from anywhere) ---- */

  // A) BroadcastChannel -> message (works across normal tabs)
  try {
    const _rvChan = new BroadcastChannel('rv-hud');
    _rvChan.onmessage = (ev) => {
      window.dispatchEvent(new MessageEvent('message', { data: ev.data }));
    };
    window._rvChan = _rvChan; // debug hook
  } catch (e) {
    console.warn('BroadcastChannel not available');
  }

  // B) localStorage -> message (some browsers; same profile)
  window.addEventListener('storage', (e) => {
    if (e.key === 'rv-hud-msg' && e.newValue) {
      try {
        const data = JSON.parse(e.newValue);
        window.dispatchEvent(new MessageEvent('message', { data }));
      } catch (_) {}
    }
  });

  // C) OBS-safe direct hook: controller can call overlay._rvDeliver(msg)
  //    OBS isolates windows; this gives a direct entry point.
  window._rvDeliver = (msg) => {
    try {
      window.dispatchEvent(new MessageEvent('message', { data: msg }));
    } catch (e) {
      console.warn('rvDeliver error', e);
    }
  };

  // Labels & vehicle defaults
  let fromLabel    = qs('from','—');
  let toLabel      = qs('to','—');
  let vehicleMode  = 'image';           // image mode by default
  let vehicleEmoji = '🚐';
  let vehicleImage = qs('rv','assets/rv.png');

  // Timer state
  let paused        = false;
  let countdownSec  = 0;
  let baselineSec   = 0;
  let tickTimer     = null;
  let autoResumeTimer = null;
  let progressPct   = 0; // 0..1

  // Subtext state + timing windows
  let currentSubtext = '';
  let departingTimer = null;
  const DEPARTING_WINDOW_MS = 10_000;     // <-- 10 seconds as requested
  const ARRIVING_WINDOW_SEC = 10 * 60;    // 10 minutes

  // Debug HUD (?debug=1)
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
  function isPlane() {
    return (
      (vehicleMode === 'emoji' && /✈/.test(vehicleEmoji)) ||
      (vehicleMode === 'image' && /plane\.png$/i.test(vehicleImage))
    );
  }

  // Crossfade status text
  function setStatus(text){
    if (text === currentSubtext) return;
    currentSubtext = text;
    statusEl.classList.add('is-fading');
    setTimeout(() => {
      statusEl.textContent = text;
      statusEl.classList.toggle('paused', text.startsWith('paused'));
      requestAnimationFrame(() => statusEl.classList.remove('is-fading'));
    }, 120);
  }

  // ETA + subtext logic (never echoes labels)
  function renderETA(){
    if (paused){
      etaEl.textContent = 'ETA paused';
    } else if (countdownSec > 0){
      etaEl.textContent = `ETA ${fmtHMS(countdownSec)}`;
    } else if (baselineSec > 0){
      etaEl.textContent = 'ETA 0m';
    } else {
      etaEl.textContent = 'ETA --:--';
    }

    if (paused){
      if (!statusEl.textContent || !statusEl.textContent.startsWith('paused')) {
        setStatus('paused');
      }
    } else if (baselineSec > 0 && countdownSec <= 0){
      setStatus('arrived');
    } else if (baselineSec > 0 && countdownSec > 0){
      if (countdownSec <= ARRIVING_WINDOW_SEC) {
        setStatus('arriving soon…');
      } else {
        setStatus(isPlane() ? 'in flight…' : 'en route…');
      }
    } else {
      setStatus('departing…');
    }
    debugRender();
  }

  // Only show image if loaded OK
  if (miniIcon) {
    miniIcon.style.display = 'none';
    miniIcon.removeAttribute('src');
    miniIcon.onload  = () => { miniIcon.dataset.ok = '1'; miniIcon.style.display = 'block'; };
    miniIcon.onerror = () => { miniIcon.dataset.ok = '0'; miniIcon.style.display = 'none'; };
  }

  function applyVehicleView(){
    const plane = isPlane();
    const leftPct = (progressPct * 100) + '%';

    if (vehicleMode === 'emoji') {
      document.body.classList.add('emoji-mode');
      if (miniEmoji){
        miniEmoji.textContent = vehicleEmoji;
        miniEmoji.style.left = leftPct;
      }
      if (miniIcon){
        miniIcon.style.display = 'none';
        miniIcon.removeAttribute('src');
        miniIcon.dataset.ok = '0';
      }
    } else {
      document.body.classList.remove('emoji-mode');
      if (miniIcon){
        miniIcon.style.left = leftPct;
        const bust = vehicleImage.includes('?') ? '&v=1' : '?v=1';
        const next = vehicleImage + bust;
        if (miniIcon.getAttribute('src') !== next) miniIcon.setAttribute('src', next);
      }
      if (miniEmoji){ miniEmoji.textContent = ''; }
    }

    miniEmoji && miniEmoji.classList.toggle('is-plane', plane);
    miniIcon  && miniIcon.classList.toggle('is-plane', plane);
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
        setProgressByTimer();
        renderETA(); // shows "arrived"
      }
    }, 1000);
  }

  function stopTick(){
    if (tickTimer){ clearInterval(tickTimer); tickTimer = null; }
  }

  function setPaused(p, reason='', minutes=null){
    paused = !!p;
    if (paused){
      document.body.classList.add('paused');
      setStatus(reason ? `paused — ${reason}` : 'paused');
      if (autoResumeTimer) clearTimeout(autoResumeTimer);
      if (minutes && minutes>0){
        autoResumeTimer = setTimeout(()=>setPaused(false), minutes*60*1000);
      }
    } else {
      document.body.classList.remove('paused');
    }
    renderETA();
    if (!paused && countdownSec>0 && !tickTimer) startTick();
  }

  // ===== MESSAGE API =====
  let gotAnyMessage = false;
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

    // Manual timer
    if (msg.type === 'eta:setCountdown'){
      const h = Math.max(0, Number(msg.hours||0));
      const m = Math.max(0, Math.min(59, Number(msg.minutes||0)));
      baselineSec = (h*3600) + (m*60);
      countdownSec = baselineSec;

      // "departing…" window (10s)
      if (departingTimer) clearTimeout(departingTimer);
      setStatus('departing…');
      departingTimer = setTimeout(() => {
        if (!paused && baselineSec > 0 && countdownSec > ARRIVING_WINDOW_SEC) {
          setStatus(isPlane() ? 'in flight…' : 'en route…');
        }
      }, DEPARTING_WINDOW_MS);

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

    // Pause / Resume
    if (msg.type === 'rv:pause')       return void setPaused(true,  msg.reason || '', msg.minutes || null);
    if (msg.type === 'rv:resume')      return void setPaused(false);
    if (msg.type === 'rv:togglePause') return void setPaused(!paused, msg.reason || '');

    // Vehicle selection
    if (msg.type === 'vehicle:select'){
      const preset = (msg.preset || 'rv').toLowerCase();
      const mode   = (msg.mode || 'image').toLowerCase();
      if (mode === 'emoji'){
        vehicleMode = 'emoji';
        vehicleEmoji = (preset === 'plane') ? '✈️' : '🚐';
        document.body.classList.add('emoji-mode');
      } else {
        vehicleMode = 'image';
        vehicleImage = (preset === 'plane') ? 'assets/plane.png' : 'assets/rv.png';
        document.body.classList.remove('emoji-mode');
      }
      applyVehicleView(); renderETA();
      return;
    }
    if (msg.type === 'vehicle:emoji'){
      if (typeof msg.char === 'string' && msg.char.trim()){
        vehicleMode = 'emoji';
        vehicleEmoji = msg.char.trim();
        document.body.classList.add('emoji-mode');
        applyVehicleView(); renderETA();
      }
      return;
    }
    if (msg.type === 'vehicle:image'){
      if (typeof msg.url === 'string' && msg.url.trim()){
        vehicleMode = 'image';
        vehicleImage = msg.url.trim();
        document.body.classList.remove('emoji-mode');
        applyVehicleView(); renderETA();
      }
      return;
    }
  });

  // ===== Init =====
  updateLabels();
  setStatus('preparing…');
  renderETA();
  setProgressByTimer();
  applyVehicleView();

  // URL demo support
  const demoSec = Number(qs('demoSec', 0));
  const demoMin = Number(qs('demoMin', 0));
  const autoStartSec = Number.isFinite(demoSec) && demoSec > 0
    ? Math.floor(demoSec)
    : (Number.isFinite(demoMin) && demoMin > 0 ? Math.floor(demoMin*60) : 0);
  if (autoStartSec > 0) {
    baselineSec = autoStartSec;
    countdownSec = autoStartSec;
    setStatus('departing…');
    setTimeout(() => {
      if (countdownSec > ARRIVING_WINDOW_SEC) {
        setStatus(isPlane() ? 'in flight…' : 'en route…');
      }
    }, DEPARTING_WINDOW_MS);
    setProgressByTimer(); renderETA();
    if (!paused) startTick();
  }

  // Failsafe demo (20s) if nothing sent after 2s
  setTimeout(() => {
    if (!gotAnyMessage && baselineSec === 0) {
      baselineSec = 20; countdownSec = 20;
      setStatus('departing…');
      setTimeout(()=> setStatus('en route…'), DEPARTING_WINDOW_MS);
      setProgressByTimer(); renderETA();
      startTick();
    }
  }, 2000);
})();
