(() => {
  const qs = (k, d=null) => new URLSearchParams(location.search).get(k) ?? d;
  const mapSvg = document.getElementById('map');
  const routeSvg = document.getElementById('route');
  const rv = document.getElementById('rv');
  const rvIcon = document.getElementById('rvIcon');
  const fromEl = document.getElementById('fromState');
  const toEl = document.getElementById('toState');
  const etaEl = document.getElementById('eta');
  const statusEl = document.getElementById('status');
  const auxEl = document.getElementById('aux');
  const fx = document.getElementById('fx');
  const ctx = fx.getContext('2d');

  const resize = () => { fx.width = window.innerWidth; fx.height = window.innerHeight; };
  window.addEventListener('resize', resize); resize();

  // Params
  const statesUrl = qs('states','assets/us-states.sample.geojson');
  let fromLabel = qs('from','—');
  let toLabel = qs('to','—');
  let unit = qs('unit','mi');
  let speed = Number(qs('speed', 0));
  let etaISO = qs('eta','');
  const rvUrl = qs('rv','assets/rv.png');
  const routeColor = qs('routeColor','#4da3ff');
  rvIcon.src = rvUrl;

  // Pause state
  let paused = false;
  let savedSpeed = 0;
  let autoResumeTimer = null;

  // Projection & map
  const projection = d3.geoAlbersUsa();
  const geoPath = d3.geoPath(projection, undefined);
  let statesGeo = null;
  fetch(statesUrl).then(r => r.json()).then(geo => {
    statesGeo = geo;
    fitProjection(statesGeo);
    drawStates(geo);
  }).catch(() => {
    statusEl.textContent = 'Add a full us-states.geojson in /assets for state detection';
  });

  function fitProjection(geo){
    const w = mapSvg.clientWidth || 800, h = mapSvg.clientHeight || 450;
    projection.fitSize([w,h], geo);
  }
  function drawStates(geo){
    mapSvg.innerHTML = '';
    for (const f of geo.features){
      const p = document.createElementNS('http://www.w3.org/2000/svg','path');
      p.setAttribute('d', geoPath(f));
      p.setAttribute('class','state');
      mapSvg.appendChild(p);
    }
  }

  // Route data
  let coords = [];
  let totalDist = 0;
  let coveredDist = 0;
  let lastState = null;

  function redrawRoute(){
    routeSvg.innerHTML = '';
    if (coords.length < 2) return;
    // base
    const base = document.createElementNS('http://www.w3.org/2000/svg','path');
    base.setAttribute('class','track');
    base.setAttribute('d', linePath(coords));
    routeSvg.appendChild(base);
    // progress
    const prog = document.createElementNS('http://www.w3.org/2000/svg','path');
    prog.setAttribute('class','progress');
    prog.setAttribute('d', linePath(splitLineByDistance(coords, coveredDist)));
    prog.style.stroke = routeColor;
    routeSvg.appendChild(prog);
  }

  function linePath(lls){
    if (!lls.length) return '';
    let d='';
    for (let i=0;i<lls.length;i++){
      const px = projection(lls[i]);
      if (!px) continue;
      const [x,y] = px;
      d += i===0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    }
    return d;
  }

  // Haversine helpers
  function haversine(a,b){
    const Rmi=3958.7613, Rkm=6371.0088, R= unit==='km'?Rkm:Rmi;
    const [lon1,lat1]=a.map(v=>v*Math.PI/180), [lon2,lat2]=b.map(v=>v*Math.PI/180);
    const dlat=lat2-lat1, dlon=lon2-lon1;
    const h=Math.sin(dlat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dlon/2)**2;
    return 2*R*Math.asin(Math.sqrt(h));
  }
  function polyLength(lls){ let s=0; for(let i=1;i<lls.length;i++) s+=haversine(lls[i-1], lls[i]); return s; }
  function splitLineByDistance(lls, dist){
    if (lls.length===0) return [];
    if (dist<=0) return [lls[0]];
    let rem=dist; const out=[lls[0]];
    for(let i=1;i<lls.length;i++){
      const seg=haversine(lls[i-1], lls[i]);
      if (rem >= seg){ out.push(lls[i]); rem-=seg; }
      else { const t=rem/seg; out.push(lerpLL(lls[i-1], lls[i], t)); break; }
    }
    return out;
  }
  function lerpLL(a,b,t){ return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t]; }

  function updateHUD(){
    fromEl.textContent = fromLabel;
    toEl.textContent = toLabel;
    if (paused){
      etaEl.textContent = `ETA paused`;
      statusEl.classList.add('paused');
    } else {
      statusEl.classList.remove('paused');
      if (etaISO) {
        etaEl.textContent = `ETA ${formatEta(new Date(etaISO))}`;
      } else if (speed > 0 && totalDist > 0){
        const remaining = Math.max(0, totalDist - coveredDist);
        const hours = remaining / speed;
        etaEl.textContent = `ETA ${fmtHours(hours)}`;
      } else {
        etaEl.textContent = `ETA --:--`;
      }
    }
  }

  function fmtHours(h){
    const totalM = Math.round(h*60);
    const H = Math.floor(totalM/60);
    const M = totalM%60;
    if (H>0) return `${H}h ${M}m`;
    return `${M}m`;
  }
  function formatEta(dt){
    const now=new Date(); const ms=dt-now;
    if (isNaN(ms)) return '--:--';
    const mins=Math.max(0, Math.round(ms/60000));
    if (mins>=60){ const h=Math.floor(mins/60); const m=mins%60; return `${h}h ${m}m`; }
    return `${mins}m`;
  }

  function positionRV(){
    if (coords.length<2) return;
    const path = splitLineByDistance(coords, coveredDist);
    const last = path[path.length-1];
    const prev = path.length>1 ? path[path.length-2] : last;
    const p = projection(last), p2 = projection(prev);
    if (!p || !p2) return;
    const [x,y] = p;
    const angle = Math.atan2(y - p2[1], x - p2[0]) * 180/Math.PI;
    rv.style.left = x + 'px';
    rv.style.top  = y + 'px';
    rv.style.transform = `translate(-50%,-50%) rotate(${angle}deg)`;

    // State detection
    if (statesGeo){
      const st = detectState(last);
      if (st !== null && st !== '' && st !== lastState){
        statusEl.textContent = lastState ? `Entering ${st}` : `Starting in ${st}`;
        lastState = st;
        pulseHUD();
      }
    }
  }

  function detectState(ll){
    if (!statesGeo) return null;
    for (const f of statesGeo.features){
      if (d3.geoContains(f, [ll[0], ll[1]])) {
        return (f.properties && (f.properties.name || f.properties.STATE_NAME || f.properties.STUSPS)) || null;
      }
    }
    return null;
  }

  function pulseHUD(){
    const pill = document.querySelector('.hud-pill');
    pill.animate([{transform:'scale(1)'},{transform:'scale(1.02)'},{transform:'scale(1)'}], {duration:450, easing:'ease'});
  }

  function setPaused(p, reason='', minutes=null){
    paused = !!p;
    if (paused){
      rv.classList.add('paused');
      savedSpeed = speed;
      speed = 0; // freeze auto ETA math
      statusEl.textContent = reason ? `Paused — ${reason}` : 'Paused';
      updateHUD();
      if (autoResumeTimer){ clearTimeout(autoResumeTimer); autoResumeTimer = null; }
      if (minutes && minutes>0){
        autoResumeTimer = setTimeout(()=>{ setPaused(false); }, minutes*60*1000);
      }
    } else {
      rv.classList.remove('paused');
      if (!etaISO) speed = savedSpeed || speed;
      statusEl.textContent = `${fromLabel} → ${toLabel}`;
      updateHUD();
    }
  }

  // Public API
  window.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (msg.type === 'gps:route'){
      if (Array.isArray(msg.coords) && msg.coords.length>=2){
        coords = msg.coords;
        totalDist = polyLength(coords);
        coveredDist = Math.min(msg.covered || 0, totalDist);
        if (typeof msg.speed==='number') speed = msg.speed;
        if (typeof msg.eta==='string') etaISO = msg.eta;
        if (typeof msg.from==='string') fromLabel = msg.from;
        if (typeof msg.to==='string') toLabel = msg.to;
        redrawRoute(); updateHUD(); positionRV(); if (!paused) statusEl.textContent = `${fromLabel} → ${toLabel}`;
      }
    } else if (msg.type === 'gps:point'){
      if (paused) return; // ignore movement when paused
      if (typeof msg.lon==='number' && typeof msg.lat==='number'){
        const ll=[msg.lon, msg.lat];
        if (coords.length===0){ coords.push(ll); }
        const last = coords[coords.length-1];
        const inc = haversine(last, ll);
        coords.push(ll);
        totalDist += inc;
        coveredDist += inc;
        redrawRoute(); updateHUD(); positionRV(); statusEl.textContent = 'Traveling…';
      }
      if (typeof msg.speed==='number') speed = msg.speed;
      if (typeof msg.eta==='string') etaISO = msg.eta;
      if (typeof msg.to==='string') toLabel = msg.to;
    } else if (msg.type === 'rv:update'){
      if (typeof msg.rv==='string'){ rvIcon.src = msg.rv; }
      if (typeof msg.from==='string'){ fromLabel = msg.from; }
      if (typeof msg.to==='string'){ toLabel = msg.to; }
      if (typeof msg.eta==='string'){ etaISO = msg.eta; }
      if (typeof msg.speed==='number'){ speed = msg.speed; }
      updateHUD();
    } else if (msg.type === 'rv:pause'){
      setPaused(true, msg.reason || '', msg.minutes || null);
    } else if (msg.type === 'rv:resume'){
      setPaused(false);
    } else if (msg.type === 'rv:togglePause'){
      setPaused(!paused, msg.reason || '');
    }
  });

  // Init
  updateHUD();
})();