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
 * Caribou hexarotor top-down structural view.
 * 
 * Actual Caribou geometry (after 90° CW rotation from the top-down photo):
 * - Rectangular battery cage oriented vertically (tall, narrow)
 * - Motor 1: straight up (north) from center hub
 * - Motor 4: straight down (south) from center hub
 * - Motors 2,3: upper-right and lower-right (splayed ~55° from vertical)
 * - Motors 5,6: lower-left and upper-left (splayed ~55° from vertical)
 * - Orange tubular arms, black motor hubs with tri-blade propellers
 * - 6 batteries arranged 3x2 inside the cage
 * - Green FC module in center
 */
export function HexStructuralView({ arms, className = '' }: HexStructuralViewProps) {
  const cx = 500;
  const cy = 500;
  const armLength = 260;

  // Actual Caribou arm angles (rotated 90° CW from the photo):
  // Photo shows: top arm straight up, bottom straight down, 4 diagonal arms at ~55° from vertical
  // After 90° CW rotation:
  // M1 = 0° (right/east - was top in photo)
  // M2 = 55° (lower-right)
  // M3 = 125° (lower-left)
  // M4 = 180° (left/west - was bottom in photo)
  // M5 = 235° (upper-left)
  // M6 = 305° (upper-right)
  // 
  // Actually looking at the photo more carefully:
  // The image shows the craft with one arm straight up and one straight down (vertical axis)
  // The 4 other arms splay out at roughly 50-55° from those vertical arms
  // After 90° CW rotation, the straight arms become horizontal (left/right)
  // and the diagonal arms rotate accordingly.
  //
  // Let me use the actual angles from the photo:
  // Photo (before rotation): top=90°(up), upper-left≈145°, lower-left≈215°, bottom=270°, lower-right≈325°, upper-right≈35°
  // In SVG coords (0°=right, clockwise): top=-90°, etc.
  // After 90° CW rotation of the craft, subtract 90° from each arm's physical angle:
  const armAngles = useMemo(() => [
    -90,    // M1: top (was left in original photo) — straight up
    -35,    // M2: upper-right diagonal
    35,     // M3: lower-right diagonal  
    90,     // M4: bottom (was right in original photo) — straight down
    145,    // M5: lower-left diagonal
    215,    // M6: upper-left diagonal
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

  // Propeller blade path (tri-blade)
  const propBlade = (mx: number, my: number, bladeAngle: number, bladeLen: number) => {
    const rad = (bladeAngle * Math.PI) / 180;
    const tipX = mx + bladeLen * Math.cos(rad);
    const tipY = my + bladeLen * Math.sin(rad);
    // Blade is tapered: wide at root, narrow at tip
    const perpRad = rad + Math.PI / 2;
    const rootWidth = 12;
    const tipWidth = 4;
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

  // Battery cage dimensions (rectangular, oriented vertically to match rotated photo)
  const cageW = 180;
  const cageH = 260;

  // Battery positions inside cage (3 rows x 2 columns)
  const batteryPositions = useMemo(() => {
    const bw = 60;
    const bh = 55;
    const gap = 12;
    const startX = cx - (bw + gap / 2);
    const startY = cy - (bh * 1.5 + gap);
    const positions = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 2; col++) {
        positions.push({
          x: startX + col * (bw + gap),
          y: startY + row * (bh + gap),
          w: bw,
          h: bh
        });
      }
    }
    return positions;
  }, []);

  return (
    <div className={`relative w-full h-full flex items-center justify-center ${className}`}>
      <svg
        viewBox="0 0 1000 1000"
        className="w-full h-full max-w-[800px] max-h-[800px]"
        style={{ filter: 'drop-shadow(0 0 20px rgba(59, 130, 246, 0.1))' }}
      >
        <defs>
          {/* Subtle grid pattern */}
          <pattern id="hex-grid" width="50" height="50" patternUnits="userSpaceOnUse">
            <path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(100,116,139,0.06)" strokeWidth="0.5" />
          </pattern>
          {/* Arm gradient (orange tubular look) */}
          <linearGradient id="armGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#f97316" />
            <stop offset="50%" stopColor="#fb923c" />
            <stop offset="100%" stopColor="#ea580c" />
          </linearGradient>
          {/* Motor hub gradient */}
          <radialGradient id="motorHub" cx="50%" cy="40%" r="50%">
            <stop offset="0%" stopColor="#374151" />
            <stop offset="100%" stopColor="#111827" />
          </radialGradient>
          {/* Cage frame gradient */}
          <linearGradient id="cageGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#4b5563" />
            <stop offset="100%" stopColor="#1f2937" />
          </linearGradient>
          {/* Glow filter for active elements */}
          <filter id="motorGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Background */}
        <rect width="1000" height="1000" fill="#0f1419" />
        <rect width="1000" height="1000" fill="url(#hex-grid)" />

        {/* ===== ARMS (orange tubular beams) ===== */}
        {motorPositions.map((pos, i) => (
          <line
            key={`arm-${i}`}
            x1={cx}
            y1={cy}
            x2={pos.x}
            y2={pos.y}
            stroke="url(#armGrad)"
            strokeWidth="14"
            strokeLinecap="round"
            opacity="0.92"
          />
        ))}

        {/* Arm edge highlights (thin dark lines to give tubular depth) */}
        {motorPositions.map((pos, i) => {
          const rad = (armAngles[i] * Math.PI) / 180;
          const perpRad = rad + Math.PI / 2;
          const offset = 6;
          return (
            <g key={`arm-edge-${i}`}>
              <line
                x1={cx + offset * Math.cos(perpRad)}
                y1={cy + offset * Math.sin(perpRad)}
                x2={pos.x + offset * Math.cos(perpRad)}
                y2={pos.y + offset * Math.sin(perpRad)}
                stroke="#7c2d12"
                strokeWidth="1.5"
                opacity="0.5"
              />
              <line
                x1={cx - offset * Math.cos(perpRad)}
                y1={cy - offset * Math.sin(perpRad)}
                x2={pos.x - offset * Math.cos(perpRad)}
                y2={pos.y - offset * Math.sin(perpRad)}
                stroke="#7c2d12"
                strokeWidth="1.5"
                opacity="0.5"
              />
            </g>
          );
        })}

        {/* ===== CENTRAL BATTERY CAGE (rectangular frame) ===== */}
        {/* Outer cage frame */}
        <rect
          x={cx - cageW / 2}
          y={cy - cageH / 2}
          width={cageW}
          height={cageH}
          rx="6"
          fill="none"
          stroke="#4b5563"
          strokeWidth="4"
        />
        {/* Inner cage frame (structural cross-members) */}
        <rect
          x={cx - cageW / 2 + 8}
          y={cy - cageH / 2 + 8}
          width={cageW - 16}
          height={cageH - 16}
          rx="4"
          fill="rgba(17,24,39,0.85)"
          stroke="#374151"
          strokeWidth="2"
        />
        {/* Diagonal cross-bracing */}
        <line x1={cx - cageW / 2} y1={cy - cageH / 2} x2={cx + cageW / 2} y2={cy + cageH / 2} stroke="#374151" strokeWidth="2" opacity="0.6" />
        <line x1={cx + cageW / 2} y1={cy - cageH / 2} x2={cx - cageW / 2} y2={cy + cageH / 2} stroke="#374151" strokeWidth="2" opacity="0.6" />
        {/* Horizontal cross-member */}
        <line x1={cx - cageW / 2} y1={cy} x2={cx + cageW / 2} y2={cy} stroke="#374151" strokeWidth="2" opacity="0.6" />

        {/* ===== BATTERIES inside cage (6 units, 3x2 grid) ===== */}
        {batteryPositions.map((bp, i) => {
          const arm = arms[i];
          const soc = arm?.bat_soc_pct ?? 0;
          const socColor = getSoCColor(soc);
          return (
            <g key={`bat-${i}`}>
              {/* Battery body */}
              <rect
                x={bp.x}
                y={bp.y}
                width={bp.w}
                height={bp.h}
                rx="4"
                fill="rgba(31,41,55,0.9)"
                stroke={socColor}
                strokeWidth="1.5"
                opacity="0.9"
              />
              {/* SoC fill bar */}
              <rect
                x={bp.x + 3}
                y={bp.y + bp.h - 3 - (bp.h - 18) * (soc / 100)}
                width={bp.w - 6}
                height={(bp.h - 18) * (soc / 100)}
                rx="2"
                fill={socColor}
                opacity="0.3"
              />
              {/* Battery label */}
              <text
                x={bp.x + bp.w / 2}
                y={bp.y + 12}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize="9"
                fontFamily="monospace"
              >
                BAT {i + 1}
              </text>
              {/* SoC percentage */}
              <text
                x={bp.x + bp.w / 2}
                y={bp.y + bp.h / 2 + 4}
                textAnchor="middle"
                fill={socColor}
                fontSize="13"
                fontWeight="bold"
                fontFamily="monospace"
              >
                {soc}%
              </text>
              {/* Temp */}
              <text
                x={bp.x + bp.w / 2}
                y={bp.y + bp.h - 6}
                textAnchor="middle"
                fill="#64748b"
                fontSize="9"
                fontFamily="monospace"
              >
                {arm?.bat_temp_c ?? 0}°C
              </text>
            </g>
          );
        })}

        {/* ===== FLIGHT CONTROLLER (green square in center) ===== */}
        <rect
          x={cx - 22}
          y={cy - 22}
          width="44"
          height="44"
          rx="4"
          fill="#166534"
          stroke="#22c55e"
          strokeWidth="1.5"
          opacity="0.9"
        />
        <text x={cx} y={cy + 3} textAnchor="middle" fill="#86efac" fontSize="8" fontFamily="monospace" fontWeight="bold">
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
          const motorR = 28;

          // SoC arc (battery ring around motor)
          const socAngle = (arm.bat_soc_pct / 100) * 360;
          const socArcPath = socAngle > 0 ? describeArc(pos.x, pos.y, motorR + 38, -90, -90 + Math.min(socAngle, 359.9)) : '';

          // Tri-blade propeller (3 blades at 120° intervals)
          const bladeLen = 62;
          const bladeBaseAngle = (i * 30) % 360; // Offset each motor's prop orientation slightly

          // Data label positioning — place outside the propeller disc
          const labelAngle = armAngles[i];
          const labelRad = (labelAngle * Math.PI) / 180;
          const labelDist = motorR + 95;
          const labelX = pos.x + labelDist * Math.cos(labelRad);
          const labelY = pos.y + labelDist * Math.sin(labelRad);
          // Determine text anchor based on position
          const textAnchor = pos.x > cx + 50 ? 'start' : pos.x < cx - 50 ? 'end' : 'middle';

          return (
            <g key={`motor-${i}`}>
              {/* Propeller disc (faint circle showing sweep area) */}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={motorR + 32}
                fill="none"
                stroke="rgba(100,116,139,0.15)"
                strokeWidth="1"
                strokeDasharray="4 4"
              />

              {/* Tri-blade propellers */}
              {[0, 120, 240].map(bladeOffset => (
                <path
                  key={`blade-${i}-${bladeOffset}`}
                  d={propBlade(pos.x, pos.y, bladeBaseAngle + bladeOffset, bladeLen)}
                  fill="rgba(17,24,39,0.85)"
                  stroke="#374151"
                  strokeWidth="1"
                  opacity="0.8"
                />
              ))}

              {/* SoC ring (battery level) */}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={motorR + 38}
                fill="none"
                stroke="rgba(100,116,139,0.15)"
                strokeWidth="4"
              />
              {socArcPath && (
                <path
                  d={socArcPath}
                  fill="none"
                  stroke={socColor}
                  strokeWidth="4"
                  strokeLinecap="round"
                  opacity="0.85"
                />
              )}

              {/* Motor hub (black circle) */}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={motorR}
                fill="url(#motorHub)"
                stroke="#4b5563"
                strokeWidth="2"
              />

              {/* RPM indicator ring inside motor hub */}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={motorR * 0.7}
                fill="none"
                stroke={rpmColor}
                strokeWidth="3"
                strokeDasharray={`${(arm.rpm_pct / 140) * (2 * Math.PI * motorR * 0.7)} ${2 * Math.PI * motorR * 0.7}`}
                strokeLinecap="round"
                transform={`rotate(-90 ${pos.x} ${pos.y})`}
                opacity="0.9"
                filter="url(#motorGlow)"
              />

              {/* Motor center dot */}
              <circle cx={pos.x} cy={pos.y} r="5" fill="#1f2937" stroke="#6b7280" strokeWidth="1" />

              {/* Motor number label */}
              <text
                x={pos.x}
                y={pos.y - motorR - 42}
                textAnchor="middle"
                fill="#e2e8f0"
                fontSize="12"
                fontWeight="bold"
                fontFamily="monospace"
              >
                M{arm.motorId}
              </text>

              {/* Data labels positioned outside propeller disc */}
              <g>
                <text x={labelX} y={labelY - 18} textAnchor={textAnchor} fill={rpmColor} fontSize="11" fontFamily="monospace" fontWeight="bold">
                  {arm.rpm_pct}% RPM
                </text>
                <text x={labelX} y={labelY - 4} textAnchor={textAnchor} fill={escTempColor} fontSize="10" fontFamily="monospace">
                  ESC {arm.esc_temp_c}°C
                </text>
                <text x={labelX} y={labelY + 10} textAnchor={textAnchor} fill="#94a3b8" fontSize="10" fontFamily="monospace">
                  {arm.esc_voltage_v.toFixed(1)}V / {arm.esc_current_a.toFixed(1)}A
                </text>
                <text x={labelX} y={labelY + 24} textAnchor={textAnchor} fill="#64748b" fontSize="10" fontFamily="monospace">
                  {power}W
                </text>
              </g>
            </g>
          );
        })}

        {/* ===== HEADER LABEL ===== */}
        <text x="20" y="30" fill="#e2e8f0" fontSize="14" fontFamily="monospace" fontWeight="bold">
          CARIBOU HEX-6 — STRUCTURAL VIEW
        </text>
        <text x="20" y="48" fill="#64748b" fontSize="11" fontFamily="monospace">
          6× Independent Motor / ESC / Battery
        </text>

        {/* ===== LEGEND ===== */}
        <g transform="translate(20, 930)">
          <text fill="#94a3b8" fontSize="10" fontFamily="monospace" y="0" fontWeight="bold">LEGEND</text>
          <circle cx="5" cy="18" r="4" fill="#22c55e" />
          <text x="14" y="22" fill="#94a3b8" fontSize="9" fontFamily="monospace">Good (&gt;60% SoC / &lt;50°C)</text>
          <circle cx="5" cy="34" r="4" fill="#eab308" />
          <text x="14" y="38" fill="#94a3b8" fontSize="9" fontFamily="monospace">Warning (30-60% / 50-70°C)</text>
          <circle cx="5" cy="50" r="4" fill="#ef4444" />
          <text x="14" y="54" fill="#94a3b8" fontSize="9" fontFamily="monospace">Critical (&lt;15% / &gt;85°C)</text>
        </g>

        <g transform="translate(700, 930)">
          <text fill="#94a3b8" fontSize="10" fontFamily="monospace" y="0" fontWeight="bold">RINGS</text>
          <text fill="#64748b" fontSize="9" fontFamily="monospace" y="18">Outer = Battery SoC</text>
          <text fill="#64748b" fontSize="9" fontFamily="monospace" y="34">Inner = Motor RPM %</text>
          <text fill="#64748b" fontSize="9" fontFamily="monospace" y="50">Cage = Per-cell SoC bars</text>
        </g>
      </svg>
    </div>
  );
}
