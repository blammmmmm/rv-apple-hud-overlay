(() => {
  const qs = (k, d = null) => new URLSearchParams(location.search).get(k) ?? d;

  // DOM
  const rv = document.getElementById('rv');               // may be hidden by CSS (that's fine)
  const rvIcon = document.getElementById('rvIcon');
  const fromEl = document.getElementById('fromState');
  const toEl   = document.getElementById('toState');
  const etaEl  = document.getElementById('eta');
  const statusEl = document.getElementById('status');

  // Labels & icon (URL params optional)
  let fromLabel = qs('from', '—');
  let toLabel   = qs('to',   '—');
  const rvUrl   = qs('rv', 'assets/rv.png');
  if (rvIcon) rvIcon.src = rvUrl;

  // Manual ETA timer state
  let paused = false;
  let countdownSec = 0;          // current remaining seconds
  let baselineSec  = 0;          // last "set" value (for Reset)
  let tickTimer = null;
  let autoResumeTimer = null;

  // ---------- helpers ----------
  function updateLabels() {
    fromEl.textContent = fromLabel;
    toEl.textContent   = toLabel;
  }

  function fmtHMS(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function renderETA() {
    if (paused) {
      etaEl.textContent = 'ETA paused';
      statusEl.classList.add('paused');
      return;
    }
    statusEl.classList.remove('paused');

    if (countdownSec > 0) {
      etaEl.textContent = `ETA ${fmtHMS(countdownSec)}`;
    } else if (baselineSec > 0) {
      etaEl.textContent = 'ETA 0m';
      statusEl.textContent = 'Arrived';
    } else {
      etaEl.textContent = 'ETA --:--';
    }
  }

  function startTick() {
    if (tickTimer) clearInterval(tickTimer);
    // tick every second
    tickTimer = setInterval(() => {
      if (paused) return;
      if (countdownSec > 0) {
        countdownSec -= 1;
        renderETA();
      } else if (baselineSec > 0) {
        // reached zero
        clearInterval(tickTimer);
        tickTimer = null;
        statusEl.textContent = 'Arrived';
        renderETA();
      }
    }, 1000);
  }

  function stopTick() {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  function setPaused(p, reason = '', minutes = null) {
    paused = !!p;
    if (paused) {
      document.body.classList.add('paused');     // pauses mini RV CSS animation
      if (rv) rv.classList.add('paused');
      statusEl.textContent = reason ? `Paused — ${reason}` : 'Paused';
      renderETA();

      if (autoResumeTimer) clearTimeout(autoResumeTimer);
      if (minutes && minutes > 0) {
        autoResumeTimer = setTimeout(() => setPaused(false), minutes * 60 * 1000);
      }
    } else {
      document.body.classList.remove('paused');
      if (rv) rv.classList.remove('paused');
      statusEl.textContent = `${fromLabel} → ${toLabel}`;
      renderETA();
      if (countdownSec > 0 && !tickTimer) startTick();
    }
  }

  // ---------- message API (manual only) ----------
  window.addEventListener('message', (event) => {
    const msg = event.data || {};

    // labels / icon
    if (msg.type === 'rv:update') {
      if (typeof msg.rv === 'string' && rvIcon) rvIcon.src = msg.rv;
      if (typeof msg.from === 'string') fromLabel = msg.from;
      if (typeof msg.to === 'string')   toLabel   = msg.to;
      statusEl.textContent = `${fromLabel} → ${toLabel}`;
      updateLabels(); renderETA();
      return;
    }

    // start/set timer (hours, minutes)
    if (msg.type === 'eta:setCountdown') {
      const h = Math.max(0, Number(msg.hours || 0));
      const m = Math.max(0, Math.min(59, Number(msg.minutes || 0)));
      baselineSec  = (h * 3600) + (m * 60);
      countdownSec = baselineSec;
      statusEl.textContent = `${fromLabel} → ${toLabel}`;
      renderETA();
      if (!paused) startTick();
      return;
    }

    // add/subtract minutes
    if (msg.type === 'eta:addMinutes') {
      const delta = Number(msg.minutes || 0) * 60;
      countdownSec = Math.max(0, countdownSec + delta);
      baselineSec  = Math.max(0, baselineSec + delta);
      renderETA();
      if (!paused && countdownSec > 0 && !tickTimer) startTick();
      if (countdownSec === 0) stopTick();
      return;
    }

    // reset to last set H:M
    if (msg.type === 'eta:resetCountdown') {
      countdownSec = baselineSec;
      renderETA();
      if (!paused && countdownSec > 0 && !tickTimer) startTick();
      if (countdownSec === 0) stopTick();
      return;
    }

    // clear the timer
    if (msg.type === 'eta:stop') {
      baselineSec = 0;
      countdownSec = 0;
      stopTick();
      renderETA();
      return;
    }

    // pause / resume controls
    if (msg.type === 'rv:pause')  return void setPaused(true,  msg.reason || '', msg.minutes || null);
    if (msg.type === 'rv:resume') return void setPaused(false);
    if (msg.type === 'rv:togglePause') return void setPaused(!paused, msg.reason || '');
  });

  // ---------- init ----------
  updateLabels();
  renderETA();
})();
