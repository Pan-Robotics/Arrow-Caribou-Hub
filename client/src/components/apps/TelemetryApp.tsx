import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Activity, 
  Battery, 
  Navigation, 
  MapPin, 
  Satellite,
  Gauge,
  Zap,
  Thermometer,
  Plane,
  Loader2,
  Hexagon,
  Monitor
} from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { useDroneSelection } from '@/hooks/useDroneSelection';
import { ConnectionStatus, useLastDataTimestamp } from '@/components/ui/ConnectionStatus';
import { HexStructuralView, type ArmData } from '@/components/telemetry/HexStructuralView';
import { CockpitHUD } from '@/components/telemetry/CockpitHUD';

interface TelemetryData {
  attitude: {
    roll_deg: number;
    pitch_deg: number;
    yaw_deg: number;
    timestamp: string;
  } | null;
  position: {
    latitude_deg: number;
    longitude_deg: number;
    absolute_altitude_m: number;
    relative_altitude_m: number;
    timestamp: string;
  } | null;
  gps: {
    num_satellites: number;
    fix_type: number;
    timestamp: string;
  } | null;
  battery_fc: {
    voltage_v: number;
    remaining_percent: number;
    timestamp: string;
  } | null;
  battery_uavcan: {
    battery_id: number;
    voltage_v: number;
    current_a: number;
    temperature_k: number;
    state_of_charge_pct: number;
    timestamp: string;
  } | null;
  // Extended: per-arm data for hexarotor (6 independent systems)
  arms?: ArmData[];
  in_air: boolean;
  // Extended flight data
  airspeed_ms?: number;
  vertical_speed_ms?: number;
  flight_mode?: string;
}

export default function TelemetryApp() {
  const { selectedDrone, setSelectedDrone, drones, isLoading: dronesLoading } = useDroneSelection("telemetry");
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const { lastDataAt, markDataReceived, reset: resetDataTimestamp } = useLastDataTimestamp();
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [activeTab, setActiveTab] = useState<string>('structural');

  useEffect(() => {
    if (!selectedDrone) return;

    // Reset state when switching drones
    setTelemetry(null);
    resetDataTimestamp();
    setLastUpdate(null);

    // Connect to WebSocket
    const newSocket = io({
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
    });

    newSocket.on('connect', () => {
      console.log('[Telemetry] WebSocket connected');
      newSocket.emit('subscribe', selectedDrone);
    });

    newSocket.on('disconnect', () => {
      console.log('[Telemetry] WebSocket disconnected');
    });

    newSocket.on('telemetry', (data: { drone_id: string; timestamp: string; telemetry: TelemetryData }) => {
      if (data.drone_id === selectedDrone) {
        setTelemetry(data.telemetry);
        setLastUpdate(new Date());
        markDataReceived();
      }
    });

    setSocket(newSocket);

    return () => {
      newSocket.emit('unsubscribe', selectedDrone);
      newSocket.disconnect();
    };
  }, [selectedDrone]);

  // Derive arm data from telemetry (or generate demo data from available battery info)
  const armData: ArmData[] = telemetry?.arms ?? derivedArmData(telemetry);

  const formatTimestamp = (timestamp: string | null) => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp).toLocaleTimeString();
  };

  const getGPSFixType = (fixType: number) => {
    const types = ['No Fix', '2D Fix', '3D Fix', 'DGPS', 'RTK Float', 'RTK Fixed'];
    return types[fixType] || 'Unknown';
  };

  const getBatteryColor = (percent: number) => {
    if (percent > 60) return 'text-green-500';
    if (percent > 30) return 'text-yellow-500';
    return 'text-red-500';
  };

  return (
    <div className="h-full w-full overflow-hidden bg-background flex flex-col">
      {/* Compact header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold">Flight Telemetry</h1>
          {selectedDrone && lastDataAt == null && (
            <span className="text-xs text-muted-foreground">Demo mode — {selectedDrone}</span>
          )}
          {!selectedDrone && !dronesLoading && (
            <span className="text-xs text-yellow-500">No drone selected</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {dronesLoading ? (
            <Loader2 className="animate-spin" size={14} />
          ) : drones && drones.length > 0 ? (
            <Select value={selectedDrone || undefined} onValueChange={setSelectedDrone}>
              <SelectTrigger className="h-7 w-[160px] text-xs">
                <SelectValue placeholder="Select drone" />
              </SelectTrigger>
              <SelectContent>
                {drones.map((drone) => (
                  <SelectItem key={drone.id} value={drone.droneId}>
                    {drone.name || drone.droneId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <ConnectionStatus
            socketConnected={socket?.connected ?? false}
            lastDataAt={lastDataAt}
            staleThresholdSeconds={10}
          />
        </div>
      </div>

      {/* Main content — fills remaining space */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          <div className="px-3 pt-1 shrink-0">
            <TabsList className="h-8 grid grid-cols-3 max-w-xs">
              <TabsTrigger value="structural" className="text-xs h-7 flex items-center gap-1">
                <Hexagon className="h-3.5 w-3.5" />
                Structure
              </TabsTrigger>
              <TabsTrigger value="cockpit" className="text-xs h-7 flex items-center gap-1">
                <Monitor className="h-3.5 w-3.5" />
                Cockpit
              </TabsTrigger>
              <TabsTrigger value="data" className="text-xs h-7 flex items-center gap-1">
                <Activity className="h-3.5 w-3.5" />
                Data
              </TabsTrigger>
            </TabsList>
          </div>

          {/* ===== STRUCTURAL VIEW TAB ===== */}
          <TabsContent value="structural" className="flex-1 overflow-hidden m-0 p-0">
            <div className="w-full h-full bg-[#0f1419]">
              <HexStructuralView arms={armData} className="w-full h-full" />
            </div>
          </TabsContent>

          {/* ===== COCKPIT HUD TAB ===== */}
          <TabsContent value="cockpit" className="flex-1 overflow-hidden m-0 p-0">
            <div className="w-full h-full bg-[#0f1419]">
              <CockpitHUD
                attitude={telemetry?.attitude ?? { roll_deg: 0, pitch_deg: 0, yaw_deg: 0 }}
                position={telemetry?.position ?? null}
                gps={telemetry?.gps ?? null}
                battery_fc={telemetry?.battery_fc ?? null}
                in_air={telemetry?.in_air ?? false}
                airspeed_ms={telemetry?.airspeed_ms ?? 0}
                vertical_speed_ms={telemetry?.vertical_speed_ms ?? 0}
                flight_mode={telemetry?.flight_mode ?? 'STABILIZE'}
              />
            </div>
          </TabsContent>

          {/* ===== DATA CARDS TAB ===== */}
          <TabsContent value="data" className="flex-1 overflow-auto m-0 p-3">
            {selectedDrone && (
              <div className="space-y-6">
                {/* Flight Status */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Plane className="h-5 w-5" />
                      Flight Status
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-4">
                      <Badge variant={telemetry?.in_air ? 'default' : 'secondary'} className="text-lg px-4 py-2">
                        {telemetry?.in_air ? '✈️ In Air' : '🛬 On Ground'}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Attitude */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Navigation className="h-5 w-5" />
                        Attitude
                      </CardTitle>
                      <CardDescription>Roll, Pitch, Yaw (degrees)</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {telemetry?.attitude ? (
                        <>
                          <div className="space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="text-sm font-medium">Roll</span>
                              <span className="text-2xl font-bold">{telemetry.attitude.roll_deg.toFixed(1)}°</span>
                            </div>
                            <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-blue-500 transition-all"
                                style={{ 
                                  width: `${Math.min(100, Math.abs(telemetry.attitude.roll_deg) / 90 * 100)}%`,
                                  marginLeft: telemetry.attitude.roll_deg < 0 ? '0' : 'auto',
                                  marginRight: telemetry.attitude.roll_deg > 0 ? '0' : 'auto'
                                }}
                              />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="text-sm font-medium">Pitch</span>
                              <span className="text-2xl font-bold">{telemetry.attitude.pitch_deg.toFixed(1)}°</span>
                            </div>
                            <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-green-500 transition-all"
                                style={{ 
                                  width: `${Math.min(100, Math.abs(telemetry.attitude.pitch_deg) / 90 * 100)}%`,
                                  marginLeft: telemetry.attitude.pitch_deg < 0 ? '0' : 'auto',
                                  marginRight: telemetry.attitude.pitch_deg > 0 ? '0' : 'auto'
                                }}
                              />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="text-sm font-medium">Yaw</span>
                              <span className="text-2xl font-bold">{telemetry.attitude.yaw_deg.toFixed(1)}°</span>
                            </div>
                            <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-purple-500 transition-all"
                                style={{ width: `${(telemetry.attitude.yaw_deg / 360) * 100}%` }}
                              />
                            </div>
                          </div>

                          <p className="text-xs text-muted-foreground">
                            Updated: {formatTimestamp(telemetry.attitude.timestamp)}
                          </p>
                        </>
                      ) : (
                        <p className="text-muted-foreground">No attitude data</p>
                      )}
                    </CardContent>
                  </Card>

                  {/* Position */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <MapPin className="h-5 w-5" />
                        Position
                      </CardTitle>
                      <CardDescription>GPS coordinates and altitude</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {telemetry?.position ? (
                        <>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <p className="text-sm text-muted-foreground">Latitude</p>
                              <p className="text-lg font-mono">{telemetry.position.latitude_deg.toFixed(6)}°</p>
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">Longitude</p>
                              <p className="text-lg font-mono">{telemetry.position.longitude_deg.toFixed(6)}°</p>
                            </div>
                          </div>

                          <Separator />

                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <p className="text-sm text-muted-foreground">Altitude (AGL)</p>
                              <p className="text-2xl font-bold">{telemetry.position.relative_altitude_m.toFixed(1)} m</p>
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">Altitude (MSL)</p>
                              <p className="text-2xl font-bold">{telemetry.position.absolute_altitude_m.toFixed(1)} m</p>
                            </div>
                          </div>

                          <p className="text-xs text-muted-foreground">
                            Updated: {formatTimestamp(telemetry.position.timestamp)}
                          </p>
                        </>
                      ) : (
                        <p className="text-muted-foreground">No position data</p>
                      )}
                    </CardContent>
                  </Card>

                  {/* GPS */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Satellite className="h-5 w-5" />
                        GPS
                      </CardTitle>
                      <CardDescription>Satellite information</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {telemetry?.gps ? (
                        <>
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">Satellites</span>
                            <span className="text-3xl font-bold">{telemetry.gps.num_satellites}</span>
                          </div>

                          <Separator />

                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">Fix Type</span>
                            <Badge variant={telemetry.gps.fix_type >= 3 ? 'default' : 'secondary'}>
                              {getGPSFixType(telemetry.gps.fix_type)}
                            </Badge>
                          </div>

                          <p className="text-xs text-muted-foreground">
                            Updated: {formatTimestamp(telemetry.gps.timestamp)}
                          </p>
                        </>
                      ) : (
                        <p className="text-muted-foreground">No GPS data</p>
                      )}
                    </CardContent>
                  </Card>

                  {/* FC Battery */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Battery className="h-5 w-5" />
                        Flight Controller Battery
                      </CardTitle>
                      <CardDescription>Main battery status</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {telemetry?.battery_fc ? (
                        <>
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">Charge</span>
                            <span className={`text-3xl font-bold ${getBatteryColor(telemetry.battery_fc.remaining_percent)}`}>
                              {telemetry.battery_fc.remaining_percent.toFixed(0)}%
                            </span>
                          </div>

                          <div className="w-full bg-secondary h-3 rounded-full overflow-hidden">
                            <div 
                              className={`h-full transition-all rounded-full ${
                                telemetry.battery_fc.remaining_percent > 60 ? 'bg-green-500' :
                                telemetry.battery_fc.remaining_percent > 30 ? 'bg-yellow-500' : 'bg-red-500'
                              }`}
                              style={{ width: `${telemetry.battery_fc.remaining_percent}%` }}
                            />
                          </div>

                          <Separator />

                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium flex items-center gap-1">
                              <Zap className="h-4 w-4" /> Voltage
                            </span>
                            <span className="text-xl font-bold">{telemetry.battery_fc.voltage_v.toFixed(2)} V</span>
                          </div>

                          <p className="text-xs text-muted-foreground">
                            Updated: {formatTimestamp(telemetry.battery_fc.timestamp)}
                          </p>
                        </>
                      ) : (
                        <p className="text-muted-foreground">No FC battery data</p>
                      )}
                    </CardContent>
                  </Card>

                  {/* UAVCAN Battery */}
                  <Card className="md:col-span-2">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Gauge className="h-5 w-5" />
                        UAVCAN Smart Battery
                      </CardTitle>
                      <CardDescription>Detailed battery telemetry via UAVCAN</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {telemetry?.battery_uavcan ? (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                          <div className="text-center">
                            <p className="text-sm text-muted-foreground mb-1">State of Charge</p>
                            <p className={`text-3xl font-bold ${getBatteryColor(telemetry.battery_uavcan.state_of_charge_pct)}`}>
                              {telemetry.battery_uavcan.state_of_charge_pct.toFixed(1)}%
                            </p>
                          </div>
                          <div className="text-center">
                            <p className="text-sm text-muted-foreground mb-1 flex items-center justify-center gap-1">
                              <Zap className="h-3 w-3" /> Voltage
                            </p>
                            <p className="text-3xl font-bold">{telemetry.battery_uavcan.voltage_v.toFixed(2)} V</p>
                          </div>
                          <div className="text-center">
                            <p className="text-sm text-muted-foreground mb-1">Current</p>
                            <p className="text-3xl font-bold">{telemetry.battery_uavcan.current_a.toFixed(2)} A</p>
                          </div>
                          <div className="text-center">
                            <p className="text-sm text-muted-foreground mb-1 flex items-center justify-center gap-1">
                              <Thermometer className="h-3 w-3" /> Temperature
                            </p>
                            <p className="text-3xl font-bold">
                              {(telemetry.battery_uavcan.temperature_k - 273.15).toFixed(1)}°C
                            </p>
                          </div>

                          <div className="col-span-2 md:col-span-4">
                            <p className="text-xs text-muted-foreground">
                              Battery ID: {telemetry.battery_uavcan.battery_id} · Updated: {formatTimestamp(telemetry.battery_uavcan.timestamp)}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-muted-foreground">No UAVCAN battery data</p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

/**
 * Derive per-arm data from available telemetry.
 * If the telemetry doesn't include per-arm data yet (legacy format),
 * we synthesize representative data from the UAVCAN battery and FC battery.
 * This allows the structural view to render meaningfully even before
 * the companion computer sends full per-arm telemetry.
 */
function derivedArmData(telemetry: TelemetryData | null): ArmData[] {
  if (!telemetry) {
    // Return demo data so the structural view is always visible
    return [
      { motorId: 1, rpm: 5760, esc_temp_c: 45, esc_voltage_v: 48.2, esc_current_a: 12.5, bat_temp_c: 32, bat_soc_pct: 85 },
      { motorId: 2, rpm: 5600, esc_temp_c: 43, esc_voltage_v: 48.1, esc_current_a: 11.8, bat_temp_c: 30, bat_soc_pct: 82 },
      { motorId: 3, rpm: 5920, esc_temp_c: 47, esc_voltage_v: 47.9, esc_current_a: 13.2, bat_temp_c: 34, bat_soc_pct: 78 },
      { motorId: 4, rpm: 5680, esc_temp_c: 44, esc_voltage_v: 48.0, esc_current_a: 12.1, bat_temp_c: 31, bat_soc_pct: 88 },
      { motorId: 5, rpm: 5840, esc_temp_c: 46, esc_voltage_v: 47.8, esc_current_a: 12.9, bat_temp_c: 33, bat_soc_pct: 80 },
      { motorId: 6, rpm: 5520, esc_temp_c: 42, esc_voltage_v: 48.3, esc_current_a: 11.5, bat_temp_c: 29, bat_soc_pct: 90 },
    ];
  }

  // If we have UAVCAN battery data, distribute it across 6 arms with slight variation
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
