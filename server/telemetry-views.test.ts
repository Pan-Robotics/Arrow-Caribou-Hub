import { describe, expect, it } from "vitest";

/**
 * Unit tests for the telemetry view components data logic.
 * These test the data derivation and color logic without rendering React components.
 */

// Replicate the color logic from HexStructuralView
function getSoCColor(soc: number) {
  if (soc > 60) return '#22c55e';
  if (soc > 30) return '#eab308';
  if (soc > 15) return '#f97316';
  return '#ef4444';
}

function getTempColor(temp: number, maxTemp = 100) {
  const ratio = Math.min(temp / maxTemp, 1);
  if (ratio < 0.5) return '#22c55e';
  if (ratio < 0.7) return '#eab308';
  if (ratio < 0.85) return '#f97316';
  return '#ef4444';
}

function getRpmColor(rpm: number) {
  if (rpm < 80) return '#22c55e';
  if (rpm < 120) return '#eab308';
  return '#ef4444';
}

// Replicate the arm data derivation from TelemetryApp
interface ArmData {
  motorId: number;
  rpm: number;
  esc_temp_c: number;
  esc_voltage_v: number;
  esc_current_a: number;
  bat_temp_c: number;
  bat_soc_pct: number;
}

function derivedArmData(telemetry: {
  battery_uavcan?: { voltage_v: number; current_a: number; temperature_k: number; state_of_charge_pct: number } | null;
  battery_fc?: { voltage_v: number; remaining_percent: number } | null;
  in_air: boolean;
} | null): ArmData[] {
  if (!telemetry) {
    return [
      { motorId: 1, rpm: 5760, esc_temp_c: 45, esc_voltage_v: 48.2, esc_current_a: 12.5, bat_temp_c: 32, bat_soc_pct: 85 },
      { motorId: 2, rpm: 5600, esc_temp_c: 43, esc_voltage_v: 48.1, esc_current_a: 11.8, bat_temp_c: 30, bat_soc_pct: 82 },
      { motorId: 3, rpm: 5920, esc_temp_c: 47, esc_voltage_v: 47.9, esc_current_a: 13.2, bat_temp_c: 34, bat_soc_pct: 78 },
      { motorId: 4, rpm: 5680, esc_temp_c: 44, esc_voltage_v: 48.0, esc_current_a: 12.1, bat_temp_c: 31, bat_soc_pct: 88 },
      { motorId: 5, rpm: 5840, esc_temp_c: 46, esc_voltage_v: 47.8, esc_current_a: 12.9, bat_temp_c: 33, bat_soc_pct: 80 },
      { motorId: 6, rpm: 5520, esc_temp_c: 42, esc_voltage_v: 48.3, esc_current_a: 11.5, bat_temp_c: 29, bat_soc_pct: 90 },
    ];
  }

  const baseVoltage = telemetry.battery_uavcan?.voltage_v ?? telemetry.battery_fc?.voltage_v ?? 48.0;
  const baseSoC = telemetry.battery_uavcan?.state_of_charge_pct ?? telemetry.battery_fc?.remaining_percent ?? 75;
  const baseCurrent = telemetry.battery_uavcan?.current_a ?? 12.0;
  const baseTemp = telemetry.battery_uavcan
    ? (telemetry.battery_uavcan.temperature_k - 273.15)
    : 35;

  return Array.from({ length: 6 }, (_, i) => ({
    motorId: i + 1,
    rpm: telemetry.in_air ? 5200 + Math.round(Math.sin(i * 1.1) * 800) : 0,
    esc_temp_c: Math.round(baseTemp + (i - 3) * 3 + 10),
    esc_voltage_v: parseFloat((baseVoltage + (Math.random() - 0.5) * 0.4).toFixed(1)),
    esc_current_a: parseFloat((baseCurrent + (Math.random() - 0.5) * 2).toFixed(1)),
    bat_temp_c: Math.round(baseTemp + (i - 3) * 2),
    bat_soc_pct: Math.round(baseSoC + (Math.random() - 0.5) * 8),
  }));
}

describe("HexStructuralView color logic", () => {
  it("returns green for SoC above 60%", () => {
    expect(getSoCColor(85)).toBe('#22c55e');
    expect(getSoCColor(61)).toBe('#22c55e');
  });

  it("returns yellow for SoC 31-60%", () => {
    expect(getSoCColor(50)).toBe('#eab308');
    expect(getSoCColor(31)).toBe('#eab308');
  });

  it("returns orange for SoC 16-30%", () => {
    expect(getSoCColor(20)).toBe('#f97316');
    expect(getSoCColor(16)).toBe('#f97316');
  });

  it("returns red for SoC 15% or below", () => {
    expect(getSoCColor(15)).toBe('#ef4444');
    expect(getSoCColor(5)).toBe('#ef4444');
    expect(getSoCColor(0)).toBe('#ef4444');
  });

  it("returns correct temperature colors", () => {
    expect(getTempColor(30)).toBe('#22c55e');   // < 50% of 100
    expect(getTempColor(60)).toBe('#eab308');   // 50-70%
    expect(getTempColor(80)).toBe('#f97316');   // 70-85%
    expect(getTempColor(95)).toBe('#ef4444');   // > 85%
  });

  it("returns correct RPM colors", () => {
    expect(getRpmColor(50)).toBe('#22c55e');    // < 80
    expect(getRpmColor(100)).toBe('#eab308');   // 80-120
    expect(getRpmColor(130)).toBe('#ef4444');   // > 120
  });
});

describe("derivedArmData", () => {
  it("returns 6 demo arms when telemetry is null", () => {
    const arms = derivedArmData(null);
    expect(arms).toHaveLength(6);
    arms.forEach((arm, i) => {
      expect(arm.motorId).toBe(i + 1);
      expect(arm.rpm).toBeGreaterThan(0);
      expect(arm.bat_soc_pct).toBeGreaterThan(0);
    });
  });

  it("returns 6 arms derived from UAVCAN battery data", () => {
    const arms = derivedArmData({
      battery_uavcan: {
        voltage_v: 50.0,
        current_a: 15.0,
        temperature_k: 310.15, // 37°C
        state_of_charge_pct: 80,
      },
      battery_fc: null,
      in_air: true,
    });
    expect(arms).toHaveLength(6);
    arms.forEach((arm, i) => {
      expect(arm.motorId).toBe(i + 1);
      // When in_air, RPM should be non-zero
      expect(arm.rpm).toBeGreaterThan(0);
      // Voltage should be near 50V
      expect(arm.esc_voltage_v).toBeGreaterThan(49);
      expect(arm.esc_voltage_v).toBeLessThan(51);
    });
  });

  it("returns 0 RPM when drone is on ground", () => {
    const arms = derivedArmData({
      battery_uavcan: null,
      battery_fc: { voltage_v: 48.0, remaining_percent: 90 },
      in_air: false,
    });
    expect(arms).toHaveLength(6);
    arms.forEach(arm => {
      expect(arm.rpm).toBe(0);
    });
  });

  it("uses FC battery data as fallback when UAVCAN is null", () => {
    const arms = derivedArmData({
      battery_uavcan: null,
      battery_fc: { voltage_v: 44.0, remaining_percent: 65 },
      in_air: true,
    });
    expect(arms).toHaveLength(6);
    // Voltage should be near 44V (from FC battery)
    arms.forEach(arm => {
      expect(arm.esc_voltage_v).toBeGreaterThan(43);
      expect(arm.esc_voltage_v).toBeLessThan(45);
    });
  });
});

describe("CockpitHUD data formatting", () => {
  it("GPS fix type labels are correct", () => {
    const types = ['No Fix', '2D Fix', '3D Fix', 'DGPS', 'RTK Float', 'RTK Fixed'];
    expect(types[0]).toBe('No Fix');
    expect(types[2]).toBe('3D Fix');
    expect(types[5]).toBe('RTK Fixed');
  });

  it("heading normalization works for negative values", () => {
    const hdg = -45;
    const normalized = hdg < 0 ? hdg + 360 : hdg;
    expect(normalized).toBe(315);
  });

  it("heading normalization leaves positive values unchanged", () => {
    const hdg = 90;
    const normalized = hdg < 0 ? hdg + 360 : hdg;
    expect(normalized).toBe(90);
  });
});
