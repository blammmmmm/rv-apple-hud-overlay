# RV Apple HUD — Pill Only (No Map)
- Pill HUD only (no map/geo libraries)
- Realistic RV icon floating on transparent stage
- ETA from speed+route or from fixed ISO time
- Pause/Resume with optional auto-resume minutes

## Messages
- rv:update  { from, to, speed, eta, rv }
- gps:route  { coords:[[lon,lat],...], covered, speed, eta, from, to }  // used only for distance math + RV progress
- gps:point  { lon, lat, speed }  // increments progress if a route exists
- rv:pause   { reason, minutes }
- rv:resume

## URL params
- rv, speed, eta, from, to
