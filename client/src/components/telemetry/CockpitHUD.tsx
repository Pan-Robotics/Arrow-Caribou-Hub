import { useMemo } from 'react';

interface CockpitHUDProps {
  attitude: {
    roll_deg: number;
    pitch_deg: number;
    yaw_deg: number;
  } | null;
  position: {
    latitude_deg: number;
    longitude_deg: number;
    absolute_altitude_m: number;
    relative_altitude_m: number;
  } | null;
  gps: {
    num_satellites: number;
    fix_type: number;
  } | null;
  battery_fc: {
    voltage_v: number;
    remaining_percent: number;
  } | null;
  in_air: boolean;
  heading?: number;
  airspeed_ms?: number;
  vertical_speed_ms?: number;
  flight_mode?: string;
  className?: string;
}

/**
 * Flight Cockpit HUD
 * Minimalistic artificial horizon, compass, altitude ladder, speed tape,
 * and system state gauges overlaid in a cockpit-style layout.
 */
export function CockpitHUD({
  attitude,
  position,
  gps,
  battery_fc,
  in_air,
  heading,
  airspeed_ms = 0,
  vertical_speed_ms = 0,
  flight_mode = 'STABILIZE',
  className = ''
}: CockpitHUDProps) {
  const roll = attitude?.roll_deg ?? 0;
  const pitch = attitude?.pitch_deg ?? 0;
  const yaw = attitude?.yaw_deg ?? 0;
  const alt = position?.relative_altitude_m ?? 0;
  const hdg = heading ?? yaw;
  const sats = gps?.num_satellites ?? 0;
  const fixType = gps?.fix_type ?? 0;
  const batPct = battery_fc?.remaining_percent ?? 0;
  const batV = battery_fc?.voltage_v ?? 0;

  const fixTypeLabel = useMemo(() => {
    const types = ['No Fix', '2D', '3D', 'DGPS', 'RTK Float', 'RTK Fixed'];
    return types[fixType] || 'N/A';
  }, [fixType]);

  // Pitch ladder lines
  const pitchLines = useMemo(() => {
    const lines = [];
    for (let deg = -40; deg <= 40; deg += 10) {
      if (deg === 0) continue;
      lines.push(deg);
    }
    return lines;
  }, []);

  // Compass tick marks
  const compassTicks = useMemo(() => {
    const ticks = [];
    for (let deg = 0; deg < 360; deg += 15) {
      ticks.push(deg);
    }
    return ticks;
  }, []);

  const getCompassLabel = (deg: number) => {
    const labels: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    return labels[deg] || '';
  };

  const getBatColor = (pct: number) => {
    if (pct > 60) return '#22c55e';
    if (pct > 30) return '#eab308';
    return '#ef4444';
  };

  return (
    <div className={`relative w-full h-full bg-slate-950 overflow-hidden flex items-center justify-center ${className}`}>
      <svg viewBox="0 0 800 600" className="max-w-[800px] max-h-[600px] w-full h-auto" preserveAspectRatio="xMidYMid meet">
        <defs>
          <clipPath id="horizon-clip">
            <circle cx="400" cy="300" r="160" />
          </clipPath>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1e3a5f" />
            <stop offset="100%" stopColor="#3b82f6" />
          </linearGradient>
          <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7c4a1e" />
            <stop offset="100%" stopColor="#4a2c0a" />
          </linearGradient>
        </defs>

        {/* ===== ARTIFICIAL HORIZON (center) ===== */}
        <g clipPath="url(#horizon-clip)">
          <g transform={`rotate(${-roll} 400 300)`}>
            {/* Sky */}
            <rect
              x="0"
              y={300 - 400 + pitch * 4}
              width="800"
              height="400"
              fill="url(#sky)"
            />
            {/* Ground */}
            <rect
              x="0"
              y={300 + pitch * 4}
              width="800"
              height="400"
              fill="url(#ground)"
            />
            {/* Horizon line */}
            <line
              x1="100"
              y1={300 + pitch * 4}
              x2="700"
              y2={300 + pitch * 4}
              stroke="white"
              strokeWidth="1.5"
              opacity="0.8"
            />

            {/* Pitch ladder */}
            {pitchLines.map(deg => {
              const y = 300 + pitch * 4 - deg * 4;
              const halfWidth = deg % 20 === 0 ? 50 : 30;
              return (
                <g key={`pitch-${deg}`} opacity="0.6">
                  <line
                    x1={400 - halfWidth}
                    y1={y}
                    x2={400 + halfWidth}
                    y2={y}
                    stroke="white"
                    strokeWidth="1"
                  />
                  {deg % 20 === 0 && (
                    <>
                      <text x={400 - halfWidth - 20} y={y + 4} textAnchor="end" fill="white" fontSize="10" fontFamily="monospace">
                        {deg}
                      </text>
                      <text x={400 + halfWidth + 20} y={y + 4} textAnchor="start" fill="white" fontSize="10" fontFamily="monospace">
                        {deg}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </g>
        </g>

        {/* Horizon circle border */}
        <circle cx="400" cy="300" r="160" fill="none" stroke="#475569" strokeWidth="2" />

        {/* Roll indicator arc (top of horizon) */}
        <g>
          {/* Roll scale ticks */}
          {[-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60].map(deg => {
            const rad = ((deg - 90) * Math.PI) / 180;
            const r1 = 156;
            const r2 = deg % 30 === 0 ? 148 : 152;
            return (
              <line
                key={`roll-tick-${deg}`}
                x1={400 + r1 * Math.cos(rad)}
                y1={300 + r1 * Math.sin(rad)}
                x2={400 + r2 * Math.cos(rad)}
                y2={300 + r2 * Math.sin(rad)}
                stroke="#94a3b8"
                strokeWidth="1.5"
              />
            );
          })}
          {/* Roll pointer (triangle) */}
          <g transform={`rotate(${roll} 400 300)`}>
            <polygon
              points="400,142 395,152 405,152"
              fill="#f97316"
            />
          </g>
          {/* Fixed top reference triangle */}
          <polygon
              points="400,138 396,130 404,130"
            fill="white"
          />
        </g>

        {/* Aircraft reference symbol (fixed center) */}
        <g>
          <line x1="360" y1="300" x2="388" y2="300" stroke="#f97316" strokeWidth="3" />
          <line x1="412" y1="300" x2="440" y2="300" stroke="#f97316" strokeWidth="3" />
          <circle cx="400" cy="300" r="4" fill="none" stroke="#f97316" strokeWidth="2" />
          <line x1="388" y1="300" x2="388" y2="307" stroke="#f97316" strokeWidth="3" />
          <line x1="412" y1="300" x2="412" y2="307" stroke="#f97316" strokeWidth="3" />
        </g>

        {/* ===== SPEED TAPE (left side) ===== */}
        <g>
          <rect x="50" y="150" width="70" height="300" rx="4" fill="rgba(15,23,42,0.85)" stroke="#475569" strokeWidth="1" />
          <text x="85" y="140" textAnchor="middle" fill="#94a3b8" fontSize="10" fontFamily="monospace">
            SPD m/s
          </text>
          {/* Speed value */}
          <rect x="52" y="285" width="66" height="30" rx="3" fill="rgba(0,0,0,0.7)" stroke="#f97316" strokeWidth="1" />
          <text x="85" y="305" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold" fontFamily="monospace">
            {airspeed_ms.toFixed(1)}
          </text>
          {/* Speed ladder */}
          {Array.from({ length: 11 }, (_, i) => {
            const spd = Math.round(airspeed_ms / 5) * 5 + (i - 5) * 5;
            const y = 300 - (i - 5) * 25;
            if (y < 155 || y > 445) return null;
            return (
              <g key={`spd-${i}`} opacity="0.7">
                <line x1="110" y1={y} x2="120" y2={y} stroke="#94a3b8" strokeWidth="1" />
                <text x="105" y={y + 4} textAnchor="end" fill="#94a3b8" fontSize="9" fontFamily="monospace">
                  {spd >= 0 ? spd : ''}
                </text>
              </g>
            );
          })}
        </g>

        {/* ===== ALTITUDE TAPE (right side) ===== */}
        <g>
          <rect x="680" y="150" width="70" height="300" rx="4" fill="rgba(15,23,42,0.85)" stroke="#475569" strokeWidth="1" />
          <text x="715" y="140" textAnchor="middle" fill="#94a3b8" fontSize="10" fontFamily="monospace">
            ALT m
          </text>
          {/* Altitude value */}
          <rect x="682" y="285" width="66" height="30" rx="3" fill="rgba(0,0,0,0.7)" stroke="#f97316" strokeWidth="1" />
          <text x="715" y="305" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold" fontFamily="monospace">
            {alt.toFixed(1)}
          </text>
          {/* Altitude ladder */}
          {Array.from({ length: 11 }, (_, i) => {
            const a = Math.round(alt / 10) * 10 + (i - 5) * 10;
            const y = 300 - (i - 5) * 25;
            if (y < 155 || y > 445) return null;
            return (
              <g key={`alt-${i}`} opacity="0.7">
                <line x1="680" y1={y} x2="670" y2={y} stroke="#94a3b8" strokeWidth="1" />
                <text x="695" y={y + 4} textAnchor="start" fill="#94a3b8" fontSize="9" fontFamily="monospace">
                  {a >= 0 ? a : ''}
                </text>
              </g>
            );
          })}
          {/* Vertical speed indicator */}
          <rect x="755" y="250" width="25" height="100" rx="3" fill="rgba(15,23,42,0.85)" stroke="#475569" strokeWidth="1" />
          <text x="767" y="245" textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="monospace">VS</text>
          {/* VS bar */}
          {vertical_speed_ms !== 0 && (
            <rect
              x="758"
              y={vertical_speed_ms > 0 ? 300 - Math.min(Math.abs(vertical_speed_ms) * 10, 45) : 300}
              width="19"
              height={Math.min(Math.abs(vertical_speed_ms) * 10, 45)}
              fill={vertical_speed_ms > 0 ? '#22c55e' : '#ef4444'}
              opacity="0.7"
            />
          )}
          <text x="767" y="360" textAnchor="middle" fill="#94a3b8" fontSize="9" fontFamily="monospace">
            {vertical_speed_ms > 0 ? '+' : ''}{vertical_speed_ms.toFixed(1)}
          </text>
        </g>

        {/* ===== COMPASS / HEADING (top) ===== */}
        <g>
          <rect x="280" y="20" width="240" height="40" rx="4" fill="rgba(15,23,42,0.85)" stroke="#475569" strokeWidth="1" />
          {/* Compass tape */}
          <g clipPath="url(#compass-clip)">
            <defs>
              <clipPath id="compass-clip">
                <rect x="285" y="25" width="230" height="30" />
              </clipPath>
            </defs>
            {compassTicks.map(deg => {
              let offset = deg - hdg;
              if (offset > 180) offset -= 360;
              if (offset < -180) offset += 360;
              const x = 400 + offset * 1.5;
              if (x < 285 || x > 515) return null;
              const label = getCompassLabel(deg);
              return (
                <g key={`hdg-${deg}`}>
                  <line
                    x1={x}
                    y1={deg % 45 === 0 ? 30 : 35}
                    x2={x}
                    y2={45}
                    stroke={label ? '#e2e8f0' : '#64748b'}
                    strokeWidth={label ? '1.5' : '1'}
                  />
                  {label && (
                    <text x={x} y={55} textAnchor="middle" fill="#e2e8f0" fontSize="9" fontFamily="monospace">
                      {label}
                    </text>
                  )}
                  {deg % 45 === 0 && !label && (
                    <text x={x} y={55} textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="monospace">
                      {deg}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
          {/* Center pointer */}
          <polygon points="400,60 397,66 403,66" fill="#f97316" />
          {/* Heading value box */}
          <rect x="380" y="62" width="40" height="18" rx="2" fill="rgba(0,0,0,0.8)" stroke="#f97316" strokeWidth="1" />
          <text x="400" y="76" textAnchor="middle" fill="white" fontSize="11" fontWeight="bold" fontFamily="monospace">
            {Math.round(hdg < 0 ? hdg + 360 : hdg)}°
          </text>
        </g>

        {/* ===== STATUS PANELS (bottom) ===== */}
        {/* Flight mode */}
        <g>
          <rect x="50" y="480" width="120" height="50" rx="4" fill="rgba(15,23,42,0.85)" stroke="#475569" strokeWidth="1" />
          <text x="110" y="500" textAnchor="middle" fill="#94a3b8" fontSize="9" fontFamily="monospace">MODE</text>
          <text x="110" y="518" textAnchor="middle" fill="#22c55e" fontSize="12" fontWeight="bold" fontFamily="monospace">
            {flight_mode}
          </text>
        </g>

        {/* Flight status */}
        <g>
          <rect x="180" y="480" width="100" height="50" rx="4" fill="rgba(15,23,42,0.85)" stroke="#475569" strokeWidth="1" />
          <text x="230" y="500" textAnchor="middle" fill="#94a3b8" fontSize="9" fontFamily="monospace">STATUS</text>
          <text x="230" y="518" textAnchor="middle" fill={in_air ? '#f97316' : '#22c55e'} fontSize="12" fontWeight="bold" fontFamily="monospace">
            {in_air ? 'IN AIR' : 'GROUND'}
          </text>
        </g>

        {/* GPS */}
        <g>
          <rect x="290" y="480" width="100" height="50" rx="4" fill="rgba(15,23,42,0.85)" stroke="#475569" strokeWidth="1" />
          <text x="340" y="500" textAnchor="middle" fill="#94a3b8" fontSize="9" fontFamily="monospace">GPS</text>
          <text x="340" y="518" textAnchor="middle" fill={fixType >= 3 ? '#22c55e' : '#eab308'} fontSize="12" fontWeight="bold" fontFamily="monospace">
            {sats} SAT
          </text>
          <text x="340" y="530" textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="monospace">
            {fixTypeLabel}
          </text>
        </g>

        {/* Battery */}
        <g>
          <rect x="400" y="480" width="120" height="50" rx="4" fill="rgba(15,23,42,0.85)" stroke="#475569" strokeWidth="1" />
          <text x="460" y="500" textAnchor="middle" fill="#94a3b8" fontSize="9" fontFamily="monospace">BATTERY</text>
          <text x="460" y="518" textAnchor="middle" fill={getBatColor(batPct)} fontSize="12" fontWeight="bold" fontFamily="monospace">
            {batPct.toFixed(0)}% · {batV.toFixed(1)}V
          </text>
          {/* Battery bar */}
          <rect x="420" y="524" width="80" height="4" rx="2" fill="rgba(100,116,139,0.3)" />
          <rect x="420" y="524" width={Math.max(0, (batPct / 100) * 80)} height="4" rx="2" fill={getBatColor(batPct)} />
        </g>

        {/* Coordinates */}
        <g>
          <rect x="530" y="480" width="220" height="50" rx="4" fill="rgba(15,23,42,0.85)" stroke="#475569" strokeWidth="1" />
          <text x="640" y="500" textAnchor="middle" fill="#94a3b8" fontSize="9" fontFamily="monospace">POSITION</text>
          <text x="640" y="516" textAnchor="middle" fill="#e2e8f0" fontSize="10" fontFamily="monospace">
            {position ? `${position.latitude_deg.toFixed(6)}° / ${position.longitude_deg.toFixed(6)}°` : 'N/A'}
          </text>
          <text x="640" y="528" textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="monospace">
            MSL: {position ? `${position.absolute_altitude_m.toFixed(1)}m` : 'N/A'}
          </text>
        </g>

        {/* ===== PITCH VALUE (left of horizon) ===== */}
        <text x="195" y="300" textAnchor="end" fill="#94a3b8" fontSize="10" fontFamily="monospace">
          P {pitch.toFixed(1)}°
        </text>
        <text x="195" y="315" textAnchor="end" fill="#94a3b8" fontSize="10" fontFamily="monospace">
          R {roll.toFixed(1)}°
        </text>
      </svg>
    </div>
  );
}
