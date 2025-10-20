# RV Apple HUD Overlay — Pause/Resume Support

## New controls
- **Pause:** `window.postMessage({ type: 'rv:pause', reason: 'Bathroom break', minutes: 10 }, '*')`
  - Freezes movement updates and ETA math
  - Shows status: “Paused — Bathroom break”
  - Optional `minutes` auto-resumes when time elapses
- **Resume:** `window.postMessage({ type: 'rv:resume' }, '*')`
- **Toggle:** `window.postMessage({ type: 'rv:togglePause' }, '*')`

Other messages still work as before:
- `gps:route`, `gps:point`, `rv:update`

## Notes
- When paused, incoming `gps:point` messages are ignored (no movement).  
- If auto ETA mode was active (via `speed`), it’s restored on resume.  
- The RV bob animation is disabled during pause for a subtle “parked” look.

