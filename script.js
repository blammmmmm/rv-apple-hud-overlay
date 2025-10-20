(() => {
  const qs = (k, d = null) => new URLSearchParams(location.search).get(k) ?? d;

  // Elements
  const rv = document.getElementById('rv');
  const rvIcon = document.getElementById('rvIcon');
  const fromEl = document.getElementById('fromState');
  const toEl = document.getElementById('toState');
  const etaEl = document.getElementById('eta');
  const statusEl = document.getElementById('status');

  // Params / state
  let fromLabel = qs('from', '—');
  let toLabel = qs('to', '—');
  let unit = qs('unit', 'mi');                 // 'mi' or 'km' (affects distance math)
  let speed = Number(qs('speed', 0));          // mph or km/h
  let etaISO = qs('eta', '');                  // fixed-ETA ISO string (optional)
  const rvUrl = qs('rv', 'assets/rv.png');
  rvIcon.src = rvUrl;

  // Route/progress (for auto-ETA)
  let coords = [];
  let totalDist = 0;
  let coveredDist = 0;

  // Pause state
  let paused = false;
  let savedSpeed = 0;
  let autoResumeTimer = null;

  // ---------- Utilities ----------
  function fmtHours(h) {
    const totalM = Math.round(h * 60);
    const H = Math.floor(totalM / 60);
    const M = totalM % 60;
    return H > 0 ? `${H}h ${M}m` : `${M}m`;
  }

  function formatEta(dt) {
    const now = new Date();
    const ms = dt - now;
    if (isNaN(ms)) return '--:--';
    const mins = Math.max(0, Math.round(ms / 60000));
    if (mins >= 60) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${h}h ${m}m`;
    }
    return `${mins}m`;
  }

  function haversine(a, b) {
    const Rmi = 3958.7613, Rkm = 6371.0088, R = unit === 'km' ? Rkm : Rmi;
    const [lon1, lat1] = a.map(v => v * Math.PI / 180);
    const [lon2, lat2] = b.map(v => v * Math.PI / 180);
    const dlat = lat2 - lat1, dlon = lon2 - lon1;
    const h = Math.sin(dlat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function polyLength(lls) {
    let s = 0;
    for (let i = 1; i < lls.length; i++) s += haversine(lls[i - 1], lls[i]);
    return s;
  }

  function updateHUD() {
    fromEl.textContent = fromLabel;
    toEl.textContent = toLabel;

    if (paused) {
      etaEl.textContent = 'ETA paused';
      statusEl.classList.add('paused');
      return;
    }
    statusEl.classList.remove('paused');

    if (etaISO) {
      etaEl.textContent = `ETA ${formatEta(new Date(etaISO))}`;
    } else if (speed > 0 && totalDist > 0) {
      const remaining = Math.max(0, totalDist - coveredDist);
      const hours = remaining / speed;
      etaEl.textContent = `ETA ${fmtHours(hours)}`;
    } else {
      etaEl.textContent = 'ETA --:--';
    }
  }

  // Subtle bezier path across screen for the (hidden) large RV; harmless if .rv is display:none
  function cubic(a, b, c, d, t) {
    const it = 1 - t;
    return it * it * it * a + 3 * it * it * t * b + 3 * it * t * t * c + t * t * t * d;
  }
  function derivative(a, b, c, d, t) {
    return 3 * (1 - t) * (1 - t) * (b - a) + 6 * (1 - t) * t * (c - b) + 3 * t * t * (d - c);
  }
  function positionRV() {
    let t = 0;
    if (totalDist > 0) t = Math.min(1, Math.max(0, coveredDist / totalDist));
    const w = window.innerWidth, h = window.innerHeight;
    const p0 = { x: w * 0.15, y: h * 0.70 };
    const p1 = { x: w * 0.35, y: h * 0.60 };
    const p2 = { x: w * 0.65, y: h * 0.65 };
    const p3 = { x: w * 0.85, y: h * 0.70 };
    const x = cubic(p0.x, p1.x, p2.x, p3.x, t);
    const y = cubic(p0.y, p1.y, p2.y, p3.y, t);
    const dx = derivative(p0.x, p1.x, p2.x, p3.x, t);
    const dy = derivative(p0.y, p1.y, p2.y, p3.y, t);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    rv.style.left = x + 'px';
    rv.style.top = y + 'px';
    rv.style.transform = `translate(-50%,-50%) rotate(${angle}deg)`;
  }
  window.addEventListener('resize', positionRV);

  // ---------- Pause / Resume ----------
  function setPaused(p, reason = '', minutes = null) {
    paused = !!p;
    if (paused) {
      document.body.classList.add('paused');    // <-- lets CSS pause the in-pill RV animation
      rv.classList.add('paused');               // noop if .rv is hidden
      savedSpeed = speed;
      speed = 0;
      statusEl.textContent = reason ? `Paused — ${reason}` : 'Paused';
      updateHUD();

      if (autoResumeTimer) { clearTimeout(autoResumeTimer); autoResumeTimer = null; }
      if (minutes && minutes > 0) {
        autoResumeTimer = setTimeout(() => { setPaused(false); }, minutes * 60 * 1000);
      }
    } else {
      document.body.classList.remove('paused'); // <-- resume in-pill animation
      rv.classList.remove('paused');
      if (!etaISO) speed = savedSpeed || speed;
      statusEl.textContent = `${fromLabel} → ${toLabel}`;
      updateHUD();
    }
  }

  // ---------- Message API ----------
  window.addEventListener('message', (event) => {
    const msg = event.data || {};

    if (msg.type === 'gps:route') {
      if (Array.isArray(msg.coords) && msg.coords.length >= 2) {
        coords = msg.coords;
        totalDist = polyLength(coords);
        coveredDist = Math.min(msg.covered || 0, totalDist);
        if (typeof msg.speed === 'number') speed = msg.speed;
        if (typeof msg.eta === 'string') etaISO = msg.eta;
        if (typeof msg.from === 'string') fromLabel = msg.from;
        if (typeof msg.to === 'string') toLabel = msg.to;
        statusEl.textContent = `${fromLabel} → ${toLabel}`;
        updateHUD();
        positionRV();
      }
    } else if (msg.type === 'gps:point') {
      if (paused) return;
      if (Array.isArray(coords) && coords.length) {
        const inc = (speed > 0 ? speed / 3600 : 0.01); // miles per second approx if speed set
        coveredDist = Math.min(totalDist, coveredDist + inc);
        positionRV();
        statusEl.textContent = 'Traveling…';
        updateHUD();
      }
      if (typeof msg.speed === 'number') speed = msg.speed;
      if (typeof msg.eta === 'string') etaISO = msg.eta;
      if (typeof msg.to === 'string') toLabel = msg.to;

    } else if (msg.type === 'rv:update') {
      if (typeof msg.rv === 'string') { rvIcon.src = msg.rv; }
      if (typeof msg.from === 'string') { fromLabel = msg.from; }
      if (typeof msg.to === 'string') { toLabel = msg.to; }
      if (typeof msg.eta === 'string') { etaISO = msg.eta; }
      if (typeof msg.speed === 'number') { speed = msg.speed; }
      updateHUD();
      positionRV();

    } else if (msg.type === 'rv:pause') {
      setPaused(true, msg.reason || '', msg.minutes || null);

    } else if (msg.type === 'rv:resume') {
      setPaused(false);

    } else if (msg.type === 'rv:togglePause') {
      setPaused(!paused, msg.reason || '');
    }
  });

  // ---------- Init ----------
  updateHUD();
  positionRV();
})();
