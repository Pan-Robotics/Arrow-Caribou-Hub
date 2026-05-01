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
 * Caribou hexarotor top-down structural view — LARGE SCALE.
 * 
 * Motor numbering (clockwise from top-left corner of the long side):
 *   M1 = top-left corner, M2 = top-right corner, M3 = right (straight),
 *   M4 = bottom-right corner, M5 = bottom-left corner, M6 = left (straight)
 */
export function HexStructuralView({ arms, className = '' }: HexStructuralViewProps) {
  const cx = 600;
  const cy = 500;
  const armLength = 360;

  // Motor angles — clockwise from top-left
  const armAngles = useMemo(() => [
    -125,   // M1: top-left corner
    -55,    // M2: top-right corner
    0,      // M3: right (straight)
    55,     // M4: bottom-right corner
    125,    // M5: bottom-left corner
    180,    // M6: left (straight)
  ], []);

  // Motor positions at end of each arm
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

  // Propeller blade path (tri-blade) — LARGER
  const propBlade = (mx: number, my: number, bladeAngle: number, bladeLen: number) => {
    const rad = (bladeAngle * Math.PI) / 180;
    const tipX = mx + bladeLen * Math.cos(rad);
    const tipY = my + bladeLen * Math.sin(rad);
    const perpRad = rad + Math.PI / 2;
    const rootWidth = 16;
    const tipWidth = 5;
    const rx1 = mx + rootWidth * Math.cos(perpRad);
    const ry1 = my + rootWidth * Math.sin(perpRad);
    const rx2 = mx - rootWidth * Math.cos(perpRad);
    const ry2 = my - rootWidth * Math.sin(perpRad);
    const tx1 = tipX + tipWidth * Math.cos(perpRad);
    const ty1 = tipY + tipWidth * Math.sin(perpRad);
    const tx2 = tipX - tipWidth * Math.cos(perpRad);
    const ty2 = tipY - tipWidth * Math.sin(perpRad);
    return `M${rx1},${ry1} L${tx1},${ty1} L${tx2},${ty2} L${rx2},${ry2} Z`;
  };

  // Color helpers
  const getSoCColor = (soc: number) => {
    if (soc > 60) return '#22c55e';
    if (soc > 30) return '#eab308';
    if (soc > 15) return '#f97316';
    return '#ef4444';
  };

  const getTempColor = (temp: number, maxTemp = 100) => {
    const ratio = Math.min(temp / maxTemp, 1);
    if (ratio < 0.5) return '#22c55e';
    if (ratio < 0.7) return '#eab308';
    if (ratio < 0.85) return '#f97316';
    return '#ef4444';
  };

  const getRpmColor = (rpm: number) => {
    if (rpm < 80) return '#22c55e';
    if (rpm < 120) return '#eab308';
    return '#ef4444';
  };

  // SoC arc path generator
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

  // Battery cage dimensions (vertical rectangle — tall, narrow)
  const cageW = 200;
  const cageH = 340;

  // Battery positions inside cage (3 rows x 2 columns)
  const batteryPositions = useMemo(() => {
    const bw = 70;
    const bh = 80;
    const gapX = 16;
    const gapY = 16;
    const startX = cx - (bw + gapX / 2);
    const startY = cy - (bh * 1.5 + gapY);
    const positions = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 2; col++) {
        positions.push({
          x: startX + col * (bw + gapX),
          y: startY + row * (bh + gapY),
          w: bw,
          h: bh
        });
      }
    }
    return positions;
  }, []);

  return (
    <div className={`relative w-full h-full flex items-center justify-center overflow-hidden ${className}`}>
      <svg
        viewBox="0 0 1200 1000"
        className="w-full h-full"
        preserveAspectRatio="xMidYMid meet"
        style={{ filter: 'drop-shadow(0 0 20px rgba(59, 130, 246, 0.1))' }}
      >
        <defs>
          <pattern id="hex-grid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke="rgba(100,116,139,0.06)" strokeWidth="0.5" />
          </pattern>
          <linearGradient id="armGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#f97316" />
            <stop offset="50%" stopColor="#fb923c" />
            <stop offset="100%" stopColor="#ea580c" />
          </linearGradient>
          <radialGradient id="motorHub" cx="50%" cy="40%" r="50%">
            <stop offset="0%" stopColor="#374151" />
            <stop offset="100%" stopColor="#111827" />
          </radialGradient>
          <filter id="motorGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Background */}
        <rect width="1200" height="1000" fill="#0f1419" />
        <rect width="1200" height="1000" fill="url(#hex-grid)" />

        {/* ===== ARMS (orange tubular beams) — THICK ===== */}
        {motorPositions.map((pos, i) => (
          <line
            key={`arm-${i}`}
            x1={cx}
            y1={cy}
            x2={pos.x}
            y2={pos.y}
            stroke="url(#armGrad)"
            strokeWidth="22"
            strokeLinecap="round"
            opacity="0.92"
          />
        ))}

        {/* Arm edge highlights (tubular depth) */}
        {motorPositions.map((pos, i) => {
          const rad = (armAngles[i] * Math.PI) / 180;
          const perpRad = rad + Math.PI / 2;
          const offset = 10;
          return (
            <g key={`arm-edge-${i}`}>
              <line
                x1={cx + offset * Math.cos(perpRad)}
                y1={cy + offset * Math.sin(perpRad)}
                x2={pos.x + offset * Math.cos(perpRad)}
                y2={pos.y + offset * Math.sin(perpRad)}
                stroke="#7c2d12"
                strokeWidth="2"
                opacity="0.5"
              />
              <line
                x1={cx - offset * Math.cos(perpRad)}
                y1={cy - offset * Math.sin(perpRad)}
                x2={pos.x - offset * Math.cos(perpRad)}
                y2={pos.y - offset * Math.sin(perpRad)}
                stroke="#7c2d12"
                strokeWidth="2"
                opacity="0.5"
              />
            </g>
          );
        })}

        {/* ===== CENTRAL BATTERY CAGE (vertical rectangular frame) ===== */}
        <rect
          x={cx - cageW / 2}
          y={cy - cageH / 2}
          width={cageW}
          height={cageH}
          rx="8"
          fill="none"
          stroke="#4b5563"
          strokeWidth="5"
        />
        <rect
          x={cx - cageW / 2 + 10}
          y={cy - cageH / 2 + 10}
          width={cageW - 20}
          height={cageH - 20}
          rx="5"
          fill="rgba(17,24,39,0.85)"
          stroke="#374151"
          strokeWidth="2.5"
        />
        {/* Diagonal cross-bracing */}
        <line x1={cx - cageW / 2} y1={cy - cageH / 2} x2={cx + cageW / 2} y2={cy + cageH / 2} stroke="#374151" strokeWidth="2.5" opacity="0.6" />
        <line x1={cx + cageW / 2} y1={cy - cageH / 2} x2={cx - cageW / 2} y2={cy + cageH / 2} stroke="#374151" strokeWidth="2.5" opacity="0.6" />
        {/* Horizontal center cross-member */}
        <line x1={cx - cageW / 2} y1={cy} x2={cx + cageW / 2} y2={cy} stroke="#374151" strokeWidth="2.5" opacity="0.6" />

        {/* ===== BATTERIES inside cage (6 units, 3 rows x 2 columns) ===== */}
        {batteryPositions.map((bp, i) => {
          const arm = arms[i];
          const soc = arm?.bat_soc_pct ?? 0;
          const socColor = getSoCColor(soc);
          return (
            <g key={`bat-${i}`}>
              <rect
                x={bp.x}
                y={bp.y}
                width={bp.w}
                height={bp.h}
                rx="5"
                fill="rgba(31,41,55,0.9)"
                stroke={socColor}
                strokeWidth="2"
                opacity="0.9"
              />
              {/* SoC fill bar */}
              <rect
                x={bp.x + 4}
                y={bp.y + bp.h - 4 - (bp.h - 24) * (soc / 100)}
                width={bp.w - 8}
                height={(bp.h - 24) * (soc / 100)}
                rx="3"
                fill={socColor}
                opacity="0.3"
              />
              <text
                x={bp.x + bp.w / 2}
                y={bp.y + 16}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize="12"
                fontFamily="monospace"
              >
                BAT {i + 1}
              </text>
              <text
                x={bp.x + bp.w / 2}
                y={bp.y + bp.h / 2 + 6}
                textAnchor="middle"
                fill={socColor}
                fontSize="18"
                fontWeight="bold"
                fontFamily="monospace"
              >
                {soc}%
              </text>
              <text
                x={bp.x + bp.w / 2}
                y={bp.y + bp.h - 8}
                textAnchor="middle"
                fill="#64748b"
                fontSize="11"
                fontFamily="monospace"
              >
                {arm?.bat_temp_c ?? 0}°C
              </text>
            </g>
          );
        })}

        {/* ===== FLIGHT CONTROLLER (green square in center) ===== */}
        <rect
          x={cx - 28}
          y={cy - 28}
          width="56"
          height="56"
          rx="6"
          fill="#166534"
          stroke="#22c55e"
          strokeWidth="2"
          opacity="0.9"
        />
        <text x={cx} y={cy + 5} textAnchor="middle" fill="#86efac" fontSize="12" fontFamily="monospace" fontWeight="bold">
          FC
        </text>

        {/* ===== MOTOR NODES with propellers and data overlays ===== */}
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
          const motorR = 38;

          // SoC arc
          const socAngle = (arm.bat_soc_pct / 100) * 360;
          const socArcPath = socAngle > 0 ? describeArc(pos.x, pos.y, motorR + 48, -90, -90 + Math.min(socAngle, 359.9)) : '';

          // Tri-blade propeller
          const bladeLen = 80;
          const bladeBaseAngle = (i * 25) % 360;

          // Data label positioning — radially outward from center
          const labelRad = (armAngles[i] * Math.PI) / 180;
          const labelDist = motorR + 110;
          const labelX = pos.x + labelDist * Math.cos(labelRad);
          const labelY = pos.y + labelDist * Math.sin(labelRad);
          // Text anchor based on which side of center
          const textAnchor = pos.x > cx + 50 ? 'start' : pos.x < cx - 50 ? 'end' : 'middle';

          return (
            <g key={`motor-${i}`}>
              {/* Propeller disc outline */}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={motorR + 42}
                fill="none"
                stroke="rgba(100,116,139,0.15)"
                strokeWidth="1.5"
                strokeDasharray="6 4"
              />

              {/* Tri-blade propellers */}
              {[0, 120, 240].map(bladeOffset => (
                <path
                  key={`blade-${i}-${bladeOffset}`}
                  d={propBlade(pos.x, pos.y, bladeBaseAngle + bladeOffset, bladeLen)}
                  fill="rgba(17,24,39,0.85)"
                  stroke="#4b5563"
                  strokeWidth="1.5"
                  opacity="0.8"
                />
              ))}

              {/* SoC ring track */}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={motorR + 48}
                fill="none"
                stroke="rgba(100,116,139,0.15)"
                strokeWidth="6"
              />
              {/* SoC ring fill */}
              {socArcPath && (
                <path
                  d={socArcPath}
                  fill="none"
                  stroke={socColor}
                  strokeWidth="6"
                  strokeLinecap="round"
                  opacity="0.85"
                />
              )}

              {/* Motor hub */}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={motorR}
                fill="url(#motorHub)"
                stroke="#4b5563"
                strokeWidth="3"
              />

              {/* RPM indicator ring */}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={motorR * 0.7}
                fill="none"
                stroke={rpmColor}
                strokeWidth="5"
                strokeDasharray={`${(arm.rpm_pct / 140) * (2 * Math.PI * motorR * 0.7)} ${2 * Math.PI * motorR * 0.7}`}
                strokeLinecap="round"
                transform={`rotate(-90 ${pos.x} ${pos.y})`}
                opacity="0.9"
                filter="url(#motorGlow)"
              />

              {/* Motor center dot */}
              <circle cx={pos.x} cy={pos.y} r="6" fill="#1f2937" stroke="#6b7280" strokeWidth="1.5" />

              {/* Motor number label */}
              <text
                x={pos.x}
                y={pos.y - motorR - 54}
                textAnchor="middle"
                fill="#e2e8f0"
                fontSize="16"
                fontWeight="bold"
                fontFamily="monospace"
              >
                M{arm.motorId}
              </text>

              {/* Data labels */}
              <g>
                <text x={labelX} y={labelY - 22} textAnchor={textAnchor} fill={rpmColor} fontSize="14" fontFamily="monospace" fontWeight="bold">
                  {arm.rpm_pct}% RPM
                </text>
                <text x={labelX} y={labelY - 4} textAnchor={textAnchor} fill={escTempColor} fontSize="13" fontFamily="monospace">
                  ESC {arm.esc_temp_c}°C
                </text>
                <text x={labelX} y={labelY + 14} textAnchor={textAnchor} fill="#94a3b8" fontSize="13" fontFamily="monospace">
                  {arm.esc_voltage_v.toFixed(1)}V / {arm.esc_current_a.toFixed(1)}A
                </text>
                <text x={labelX} y={labelY + 32} textAnchor={textAnchor} fill="#64748b" fontSize="13" fontFamily="monospace">
                  {power}W
                </text>
              </g>
            </g>
          );
        })}

        {/* ===== HEADER ===== */}
        <text x="30" y="40" fill="#e2e8f0" fontSize="20" fontFamily="monospace" fontWeight="bold">
          CARIBOU HEX-6 — STRUCTURAL VIEW
        </text>
        <text x="30" y="65" fill="#64748b" fontSize="14" fontFamily="monospace">
          6× Independent Motor / ESC / Battery — CW numbering from top-left
        </text>

        {/* ===== LEGEND ===== */}
        <g transform="translate(30, 900)">
          <text fill="#94a3b8" fontSize="13" fontFamily="monospace" y="0" fontWeight="bold">LEGEND</text>
          <circle cx="8" cy="22" r="6" fill="#22c55e" />
          <text x="20" y="27" fill="#94a3b8" fontSize="12" fontFamily="monospace">Good (&gt;60% SoC / &lt;50°C)</text>
          <circle cx="8" cy="44" r="6" fill="#eab308" />
          <text x="20" y="49" fill="#94a3b8" fontSize="12" fontFamily="monospace">Warning (30-60% / 50-70°C)</text>
          <circle cx="8" cy="66" r="6" fill="#ef4444" />
          <text x="20" y="71" fill="#94a3b8" fontSize="12" fontFamily="monospace">Critical (&lt;15% / &gt;85°C)</text>
        </g>

        <g transform="translate(850, 900)">
          <text fill="#94a3b8" fontSize="13" fontFamily="monospace" y="0" fontWeight="bold">RINGS</text>
          <text fill="#64748b" fontSize="12" fontFamily="monospace" y="22">Outer = Battery SoC</text>
          <text fill="#64748b" fontSize="12" fontFamily="monospace" y="44">Inner = Motor RPM %</text>
          <text fill="#64748b" fontSize="12" fontFamily="monospace" y="66">Cage = Per-cell SoC bars</text>
        </g>
      </svg>
    </div>
  );
}
