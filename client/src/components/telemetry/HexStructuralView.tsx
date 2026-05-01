import { useMemo } from 'react';

/**
 * Per-arm data for the Caribou hexarotor.
 * Each arm has one motor, one ESC, and one battery (all independent).
 */
export interface ArmData {
  motorId: number;
  rpm_pct: number;        // 0–140 range, warning at 120+
  esc_temp_c: number;     // ESC temperature in Celsius
  esc_voltage_v: number;  // ESC bus voltage
  esc_current_a: number;  // ESC current draw
  bat_temp_c: number;     // Battery temperature in Celsius
  bat_soc_pct: number;    // Battery state of charge 0–100
}

interface HexStructuralViewProps {
  arms: ArmData[];
  className?: string;
}

/**
 * Hexarotor top-down structural view.
 * Renders an SVG representation of the Caribou frame with 6 arms at 60° intervals,
 * overlaying per-arm telemetry data (motor RPM, ESC temp, battery SoC, voltage, current).
 */
export function HexStructuralView({ arms, className = '' }: HexStructuralViewProps) {
  // SVG viewBox center and radius
  const cx = 400;
  const cy = 400;
  const armLength = 220;
  const bodyRadius = 90;
  const motorRadius = 42;

  // Arm angles: 6 arms at 60° intervals, starting from top (north = -90°)
  // Caribou layout: arms at 0°, 60°, 120°, 180°, 240°, 300° from top
  const armAngles = useMemo(() => [
    -90, -30, 30, 90, 150, 210
  ], []);

  // Calculate motor positions
  const motorPositions = useMemo(() => {
    return armAngles.map(angle => {
      const rad = (angle * Math.PI) / 180;
      return {
        x: cx + armLength * Math.cos(rad),
        y: cy + armLength * Math.sin(rad),
        angle
      };
    });
  }, [armAngles]);

  // Color helpers
  const getSoCColor = (soc: number) => {
    if (soc > 60) return '#22c55e'; // green
    if (soc > 30) return '#eab308'; // yellow
    if (soc > 15) return '#f97316'; // orange
    return '#ef4444'; // red
  };

  const getTempColor = (temp: number, maxTemp = 100) => {
    const ratio = Math.min(temp / maxTemp, 1);
    if (ratio < 0.5) return '#22c55e'; // green
    if (ratio < 0.7) return '#eab308'; // yellow
    if (ratio < 0.85) return '#f97316'; // orange
    return '#ef4444'; // red
  };

  const getRpmColor = (rpm: number) => {
    if (rpm < 80) return '#22c55e';
    if (rpm < 120) return '#eab308';
    return '#ef4444';
  };

  // SoC arc path generator (circular arc for battery ring)
  const describeArc = (x: number, y: number, radius: number, startAngle: number, endAngle: number) => {
    const start = {
      x: x + radius * Math.cos((startAngle * Math.PI) / 180),
      y: y + radius * Math.sin((startAngle * Math.PI) / 180)
    };
    const end = {
      x: x + radius * Math.cos((endAngle * Math.PI) / 180),
      y: y + radius * Math.sin((endAngle * Math.PI) / 180)
    };
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
  };

  return (
    <div className={`relative w-full h-full flex items-center justify-center ${className}`}>
      <svg
        viewBox="0 0 800 800"
        className="w-full h-full max-w-[700px] max-h-[700px]"
        style={{ filter: 'drop-shadow(0 0 20px rgba(59, 130, 246, 0.1))' }}
      >
        {/* Background grid */}
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(100,116,139,0.1)" strokeWidth="0.5" />
          </pattern>
          <radialGradient id="bodyGradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(30,41,59,0.9)" />
            <stop offset="100%" stopColor="rgba(15,23,42,0.95)" />
          </radialGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect width="800" height="800" fill="url(#grid)" />

        {/* Arms (structural beams) */}
        {motorPositions.map((pos, i) => (
          <line
            key={`arm-${i}`}
            x1={cx}
            y1={cy}
            x2={pos.x}
            y2={pos.y}
            stroke="#f97316"
            strokeWidth="6"
            strokeLinecap="round"
            opacity="0.85"
          />
        ))}

        {/* Central body (hexagonal frame) */}
        <polygon
          points={motorPositions.map((_, i) => {
            const rad = (armAngles[i] * Math.PI) / 180;
            const bx = cx + bodyRadius * Math.cos(rad);
            const by = cy + bodyRadius * Math.sin(rad);
            return `${bx},${by}`;
          }).join(' ')}
          fill="url(#bodyGradient)"
          stroke="#475569"
          strokeWidth="2"
        />

        {/* Battery bay representation (center rectangle) */}
        <rect
          x={cx - 35}
          y={cy - 50}
          width="70"
          height="100"
          rx="8"
          fill="rgba(241,245,249,0.08)"
          stroke="#64748b"
          strokeWidth="1.5"
        />
        <text x={cx} y={cy - 20} textAnchor="middle" fill="#94a3b8" fontSize="11" fontFamily="monospace">
          CARIBOU
        </text>
        <text x={cx} y={cy} textAnchor="middle" fill="#64748b" fontSize="9" fontFamily="monospace">
          HEX-6
        </text>
        <text x={cx} y={cy + 20} textAnchor="middle" fill="#64748b" fontSize="9" fontFamily="monospace">
          {arms.length === 6 ? 'ACTIVE' : 'NO DATA'}
        </text>

        {/* Motor nodes with data overlays */}
        {motorPositions.map((pos, i) => {
          const arm = arms[i] || {
            motorId: i + 1,
            rpm_pct: 0,
            esc_temp_c: 0,
            esc_voltage_v: 0,
            esc_current_a: 0,
            bat_temp_c: 0,
            bat_soc_pct: 0
          };

          const socColor = getSoCColor(arm.bat_soc_pct);
          const escTempColor = getTempColor(arm.esc_temp_c);
          const rpmColor = getRpmColor(arm.rpm_pct);
          const power = (arm.esc_voltage_v * arm.esc_current_a).toFixed(0);

          // SoC arc (battery ring around motor)
          const socAngle = (arm.bat_soc_pct / 100) * 360;
          const socArcPath = socAngle > 0 ? describeArc(pos.x, pos.y, motorRadius + 8, -90, -90 + Math.min(socAngle, 359.9)) : '';

          // Text positioning: alternate left/right based on arm position
          const isLeftSide = pos.x < cx;
          const textX = isLeftSide ? pos.x - motorRadius - 70 : pos.x + motorRadius + 12;
          const textAnchor = isLeftSide ? 'end' : 'start';

          return (
            <g key={`motor-${i}`}>
              {/* SoC ring (battery level) */}
              {socArcPath && (
                <path
                  d={socArcPath}
                  fill="none"
                  stroke={socColor}
                  strokeWidth="5"
                  strokeLinecap="round"
                  opacity="0.85"
                />
              )}
              {/* Background ring track */}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={motorRadius + 8}
                fill="none"
                stroke="rgba(100,116,139,0.2)"
                strokeWidth="5"
              />

              {/* ESC temp half-circle (left) */}
              <path
                d={describeArc(pos.x, pos.y, motorRadius - 2, 90, 270)}
                fill="none"
                stroke={escTempColor}
                strokeWidth="4"
                opacity="0.7"
              />

              {/* Motor circle background */}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={motorRadius}
                fill="rgba(15,23,42,0.9)"
                stroke="#475569"
                strokeWidth="1.5"
              />

              {/* RPM indicator (inner filled arc) */}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={motorRadius * 0.65}
                fill="none"
                stroke={rpmColor}
                strokeWidth="3"
                strokeDasharray={`${(arm.rpm_pct / 140) * (2 * Math.PI * motorRadius * 0.65)} ${2 * Math.PI * motorRadius * 0.65}`}
                strokeLinecap="round"
                transform={`rotate(-90 ${pos.x} ${pos.y})`}
                opacity="0.8"
              />

              {/* Motor number */}
              <text
                x={pos.x}
                y={pos.y - 10}
                textAnchor="middle"
                fill="#e2e8f0"
                fontSize="13"
                fontWeight="bold"
                fontFamily="monospace"
              >
                M{arm.motorId}
              </text>

              {/* RPM value */}
              <text
                x={pos.x}
                y={pos.y + 8}
                textAnchor="middle"
                fill={rpmColor}
                fontSize="12"
                fontFamily="monospace"
              >
                {arm.rpm_pct}%
              </text>

              {/* "RPM" label */}
              <text
                x={pos.x}
                y={pos.y + 22}
                textAnchor="middle"
                fill="#64748b"
                fontSize="8"
                fontFamily="monospace"
              >
                RPM
              </text>

              {/* Side data labels */}
              <text x={textX} y={pos.y - 20} textAnchor={textAnchor} fill="#94a3b8" fontSize="10" fontFamily="monospace">
                BAT: {arm.bat_soc_pct}%
              </text>
              <text x={textX} y={pos.y - 6} textAnchor={textAnchor} fill={escTempColor} fontSize="10" fontFamily="monospace">
                ESC: {arm.esc_temp_c}°C
              </text>
              <text x={textX} y={pos.y + 8} textAnchor={textAnchor} fill="#94a3b8" fontSize="10" fontFamily="monospace">
                {arm.esc_voltage_v.toFixed(1)}V
              </text>
              <text x={textX} y={pos.y + 22} textAnchor={textAnchor} fill="#94a3b8" fontSize="10" fontFamily="monospace">
                {arm.esc_current_a.toFixed(1)}A / {power}W
              </text>
            </g>
          );
        })}

        {/* Legend */}
        <g transform="translate(20, 720)">
          <text fill="#64748b" fontSize="9" fontFamily="monospace" y="0">
            ● Outer ring = Battery SoC
          </text>
          <text fill="#64748b" fontSize="9" fontFamily="monospace" y="14">
            ● Left arc = ESC Temp
          </text>
          <text fill="#64748b" fontSize="9" fontFamily="monospace" y="28">
            ● Inner ring = Motor RPM
          </text>
        </g>

        {/* Color legend */}
        <g transform="translate(600, 720)">
          <circle cx="0" cy="0" r="4" fill="#22c55e" />
          <text x="10" y="4" fill="#64748b" fontSize="9" fontFamily="monospace">Good</text>
          <circle cx="60" cy="0" r="4" fill="#eab308" />
          <text x="70" y="4" fill="#64748b" fontSize="9" fontFamily="monospace">Warn</text>
          <circle cx="120" cy="0" r="4" fill="#ef4444" />
          <text x="130" y="4" fill="#64748b" fontSize="9" fontFamily="monospace">Crit</text>
        </g>
      </svg>
    </div>
  );
}
