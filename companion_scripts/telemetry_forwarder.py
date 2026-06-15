#!/usr/bin/env python3
"""
Caribou Hub Telemetry Forwarder

Collects flight controller telemetry (MAVLink via MAVSDK) and per-arm battery/ESC data
(UAVCAN), then forwards to Caribou Hub via HTTP POST to REST endpoint.

Caribou is a hexarotor with 6 independent motor/ESC/battery systems.
Each arm has its own UAVCAN-connected BMS and ESC, identified by node ID.

Data Sources:
- Flight Controller (MAVLink over UDP):
    attitude, position, GPS, flight mode, airspeed, vertical speed, heading, in_air, battery_fc
- Per-Arm Systems (UAVCAN over CAN bus):
    6x BatteryInfo (voltage, current, temperature, SoC per cell/pack)
    6x ESC Status (RPM, temperature, voltage, current)

Usage:
    python3 telemetry_forwarder.py [--debug]

Environment Variables:
    WEB_SERVER_URL - Caribou Hub base URL (e.g., http://<hub-ip>:3000)
    API_KEY - API key for authentication
    DRONE_ID - Drone identifier (default: caribou_001)
    MAVLINK_URL - MAVLink connection URL (default: udpin://0.0.0.0:14540)
    CAN_INTERFACE - CAN interface for UAVCAN (default: can0)
    UPDATE_RATE_HZ - Telemetry update rate (default: 10)

Author: Pan Robotics
"""

import os
import sys
import json
import asyncio
import aiohttp
import logging
import argparse
import threading
from datetime import datetime
from queue import Queue, Empty
from mavsdk import System
import dronecan
from dronecan.driver.socketcan import SocketCAN

# Configuration from environment
WEB_SERVER_URL = os.getenv('WEB_SERVER_URL', 'http://<hub-ip>:3000')
API_KEY = os.getenv('API_KEY', '')
DRONE_ID = os.getenv('DRONE_ID', 'caribou_001')
MAVLINK_URL = os.getenv('MAVLINK_URL', 'udpin://0.0.0.0:14540')
CAN_INTERFACE = os.getenv('CAN_INTERFACE', 'can0')
UPDATE_RATE_HZ = float(os.getenv('UPDATE_RATE_HZ', '10'))
UAVCAN_NODE_ID = 111  # Unique node ID for this telemetry bridge

# UAVCAN Node ID mapping for Caribou's 6 independent arms.
# Each arm has a BMS node and an ESC node on the CAN bus.
# Adjust these IDs to match your actual hardware configuration.
ARM_BMS_NODE_IDS = {
    10: 1,  # Node 10 -> Motor/Arm 1 (top-left)
    11: 2,  # Node 11 -> Motor/Arm 2 (top-right)
    12: 3,  # Node 12 -> Motor/Arm 3 (right)
    13: 4,  # Node 13 -> Motor/Arm 4 (bottom-right)
    14: 5,  # Node 14 -> Motor/Arm 5 (bottom-left)
    15: 6,  # Node 15 -> Motor/Arm 6 (left)
}

ARM_ESC_NODE_IDS = {
    20: 1,  # Node 20 -> ESC 1 (top-left)
    21: 2,  # Node 21 -> ESC 2 (top-right)
    22: 3,  # Node 22 -> ESC 3 (right)
    23: 4,  # Node 23 -> ESC 4 (bottom-right)
    24: 5,  # Node 24 -> ESC 5 (bottom-left)
    25: 6,  # Node 25 -> ESC 6 (left)
}


class TelemetryForwarder:
    """Multi-threaded telemetry forwarder for Caribou hexarotor."""

    def __init__(self, debug=False):
        self.debug = debug
        self.setup_logging()

        # Configuration
        self.web_server_url = WEB_SERVER_URL.rstrip('/')
        self.api_key = API_KEY
        self.drone_id = DRONE_ID
        self.mavlink_url = MAVLINK_URL
        self.can_interface = CAN_INTERFACE
        self.update_interval = 1.0 / UPDATE_RATE_HZ

        # Telemetry state (thread-safe with locks)
        self.telemetry_lock = threading.Lock()
        self.telemetry_data = {
            # --- Flight Controller (MAVLink) ---
            'attitude': None,
            'position': None,
            'gps': None,
            'battery_fc': None,
            'in_air': False,
            'flight_mode': None,
            'airspeed_ms': None,
            'vertical_speed_ms': None,
            'heading_deg': None,
            # --- Per-Arm Systems (UAVCAN) ---
            'battery_uavcan': None,  # Aggregated (legacy compat)
            'arms': None,            # Full per-arm array
        }

        # Per-arm state (populated by UAVCAN callbacks)
        self.arm_batteries = {}  # {arm_id: {...}}
        self.arm_escs = {}       # {arm_id: {...}}

        # Threading components
        self.http_queue = Queue(maxsize=10)
        self.stop_event = threading.Event()
        self.mavlink_thread = None
        self.uavcan_thread = None
        self.http_thread = None

        # Statistics
        self.send_count = 0

    def setup_logging(self):
        level = logging.DEBUG if self.debug else logging.INFO
        logging.basicConfig(
            level=level,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        self.logger = logging.getLogger(__name__)

    # =========================================================================
    # MAVLink Workers
    # =========================================================================

    async def mavlink_worker_async(self):
        """Async worker that collects all MAVLink telemetry."""
        self.logger.info("[MAVLINK] Worker started")

        try:
            drone = System()
            await drone.connect(system_address=self.mavlink_url)

            async for state in drone.core.connection_state():
                if state.is_connected:
                    self.logger.info(f"[MAVLINK] Connected to FC: {self.mavlink_url}")
                    break

            # Set telemetry rates
            await drone.telemetry.set_rate_battery(2.0)
            await drone.telemetry.set_rate_gps_info(2.0)
            await drone.telemetry.set_rate_position(UPDATE_RATE_HZ)
            await drone.telemetry.set_rate_attitude_euler(UPDATE_RATE_HZ)
            await drone.telemetry.set_rate_velocity_ned(UPDATE_RATE_HZ)

            # Start all collectors
            asyncio.create_task(self.collect_attitude(drone))
            asyncio.create_task(self.collect_position(drone))
            asyncio.create_task(self.collect_gps(drone))
            asyncio.create_task(self.collect_battery_fc(drone))
            asyncio.create_task(self.collect_in_air(drone))
            asyncio.create_task(self.collect_flight_mode(drone))
            asyncio.create_task(self.collect_velocity(drone))
            asyncio.create_task(self.collect_heading(drone))
            asyncio.create_task(self.send_telemetry_periodic())

            while not self.stop_event.is_set():
                await asyncio.sleep(0.1)

        except Exception as e:
            self.logger.error(f"[MAVLINK] Error: {e}")
        finally:
            self.logger.info("[MAVLINK] Worker stopped")

    async def collect_attitude(self, drone):
        """Collect attitude (roll, pitch, yaw) for cockpit HUD artificial horizon."""
        try:
            async for attitude in drone.telemetry.attitude_euler():
                with self.telemetry_lock:
                    self.telemetry_data['attitude'] = {
                        'roll_deg': attitude.roll_deg,
                        'pitch_deg': attitude.pitch_deg,
                        'yaw_deg': attitude.yaw_deg,
                        'timestamp': datetime.now().isoformat()
                    }
                if self.debug:
                    self.logger.debug(f"[MAVLINK] Attitude: R={attitude.roll_deg:.1f} P={attitude.pitch_deg:.1f} Y={attitude.yaw_deg:.1f}")
        except Exception as e:
            if self.debug:
                self.logger.debug(f"[MAVLINK] Attitude error: {e}")

    async def collect_position(self, drone):
        """Collect lat/lon/alt for cockpit HUD altitude ladder and map."""
        try:
            async for position in drone.telemetry.position():
                with self.telemetry_lock:
                    self.telemetry_data['position'] = {
                        'latitude_deg': position.latitude_deg,
                        'longitude_deg': position.longitude_deg,
                        'absolute_altitude_m': position.absolute_altitude_m,
                        'relative_altitude_m': position.relative_altitude_m,
                        'timestamp': datetime.now().isoformat()
                    }
                if self.debug:
                    self.logger.debug(f"[MAVLINK] Pos: {position.latitude_deg:.6f},{position.longitude_deg:.6f} alt={position.relative_altitude_m:.1f}m")
        except Exception as e:
            if self.debug:
                self.logger.debug(f"[MAVLINK] Position error: {e}")

    async def collect_gps(self, drone):
        """Collect GPS fix info for cockpit HUD GPS status widget."""
        try:
            async for gps_info in drone.telemetry.gps_info():
                with self.telemetry_lock:
                    self.telemetry_data['gps'] = {
                        'num_satellites': gps_info.num_satellites,
                        'fix_type': gps_info.fix_type.value if hasattr(gps_info.fix_type, 'value') else int(gps_info.fix_type),
                        'timestamp': datetime.now().isoformat()
                    }
                if self.debug:
                    self.logger.debug(f"[MAVLINK] GPS: {gps_info.num_satellites} sats, fix={gps_info.fix_type}")
        except Exception as e:
            if self.debug:
                self.logger.debug(f"[MAVLINK] GPS error: {e}")

    async def collect_battery_fc(self, drone):
        """Collect FC power module battery (aggregate system voltage/SoC)."""
        try:
            async for battery in drone.telemetry.battery():
                remaining = battery.remaining_percent
                # Normalize: MAVSDK may return 0-1 or 0-100 depending on version
                if remaining <= 1.0:
                    remaining = remaining * 100
                with self.telemetry_lock:
                    self.telemetry_data['battery_fc'] = {
                        'voltage_v': battery.voltage_v,
                        'remaining_percent': remaining,
                        'timestamp': datetime.now().isoformat()
                    }
                if self.debug:
                    self.logger.debug(f"[MAVLINK] Battery(FC): {battery.voltage_v:.2f}V {remaining:.0f}%")
        except Exception as e:
            if self.debug:
                self.logger.debug(f"[MAVLINK] Battery(FC) error: {e}")

    async def collect_in_air(self, drone):
        """Collect armed/in-air status for cockpit HUD flight status."""
        try:
            async for in_air in drone.telemetry.in_air():
                with self.telemetry_lock:
                    self.telemetry_data['in_air'] = in_air
                if self.debug:
                    self.logger.debug(f"[MAVLINK] In air: {in_air}")
        except Exception as e:
            if self.debug:
                self.logger.debug(f"[MAVLINK] In air error: {e}")

    async def collect_flight_mode(self, drone):
        """Collect flight mode for cockpit HUD mode indicator."""
        try:
            async for flight_mode in drone.telemetry.flight_mode():
                mode_str = str(flight_mode).replace('FlightMode.', '')
                with self.telemetry_lock:
                    self.telemetry_data['flight_mode'] = mode_str
                if self.debug:
                    self.logger.debug(f"[MAVLINK] Mode: {mode_str}")
        except Exception as e:
            if self.debug:
                self.logger.debug(f"[MAVLINK] Flight mode error: {e}")

    async def collect_velocity(self, drone):
        """Collect velocity NED to derive vertical speed and ground speed for cockpit HUD."""
        try:
            async for velocity in drone.telemetry.velocity_ned():
                # Vertical speed: negative NED down = positive climb
                vz = -velocity.down_m_s
                # Ground speed (horizontal magnitude)
                ground_speed = (velocity.north_m_s**2 + velocity.east_m_s**2) ** 0.5

                with self.telemetry_lock:
                    self.telemetry_data['vertical_speed_ms'] = round(vz, 2)
                    self.telemetry_data['airspeed_ms'] = round(ground_speed, 2)
                if self.debug:
                    self.logger.debug(f"[MAVLINK] Vel: vz={vz:.2f} gs={ground_speed:.2f} m/s")
        except Exception as e:
            if self.debug:
                self.logger.debug(f"[MAVLINK] Velocity error: {e}")

    async def collect_heading(self, drone):
        """Collect heading for cockpit HUD compass tape."""
        try:
            async for heading in drone.telemetry.heading():
                with self.telemetry_lock:
                    self.telemetry_data['heading_deg'] = heading.heading_deg
                if self.debug:
                    self.logger.debug(f"[MAVLINK] Heading: {heading.heading_deg:.1f} deg")
        except Exception as e:
            if self.debug:
                self.logger.debug(f"[MAVLINK] Heading error: {e}")

    # =========================================================================
    # UAVCAN Worker — Per-Arm Battery & ESC Data
    # =========================================================================

    def uavcan_worker(self):
        """
        Worker thread that collects UAVCAN battery and ESC data for all 6 arms.
        Each arm's BMS and ESC are identified by their UAVCAN source node ID.
        """
        self.logger.info("[UAVCAN] Worker started")

        try:
            driver = SocketCAN(self.can_interface)
            node = dronecan.node.Node(driver, node_id=UAVCAN_NODE_ID)

            node_info = dronecan.uavcan.protocol.GetNodeInfo.Response()
            node_info.name = "caribou_telemetry_bridge"
            node_info.software_version.major = 2
            node_info.software_version.minor = 0
            node.node_info = node_info

            self.logger.info(f"[UAVCAN] Connected to CAN: {self.can_interface}")

            # --- BatteryInfo handler (per-arm BMS) ---
            def battery_callback(event):
                msg = event.message
                source_node_id = event.transfer.source_node_id

                arm_id = ARM_BMS_NODE_IDS.get(source_node_id)
                if arm_id is None:
                    if self.debug:
                        self.logger.debug(f"[UAVCAN] Unknown BMS node: {source_node_id}")
                    return

                battery_data = {
                    'voltage_v': msg.voltage,
                    'current_a': msg.current,
                    'temperature_k': msg.temperature,
                    'temperature_c': msg.temperature - 273.15 if msg.temperature > 0 else 0,
                    'soc_pct': msg.state_of_charge_pct,
                    'soh_pct': msg.state_of_health_pct,
                    'battery_id': getattr(msg, 'battery_id', arm_id),
                    'timestamp': datetime.now().isoformat()
                }

                with self.telemetry_lock:
                    self.arm_batteries[arm_id] = battery_data

                if self.debug:
                    self.logger.debug(f"[UAVCAN] BMS Arm{arm_id}: {msg.voltage:.1f}V {msg.current:.1f}A SoC={msg.state_of_charge_pct:.0f}%")

            # --- ESC Status handler (per-arm ESC) ---
            def esc_status_callback(event):
                msg = event.message
                source_node_id = event.transfer.source_node_id

                arm_id = ARM_ESC_NODE_IDS.get(source_node_id)
                if arm_id is None:
                    if self.debug:
                        self.logger.debug(f"[UAVCAN] Unknown ESC node: {source_node_id}")
                    return

                rpm_raw = getattr(msg, 'rpm', 0)

                # ESC temperature is the ESC board temp; motor_temperature is winding temp
                # Some ESCs report motor temp via a separate thermistor channel
                esc_temp_k = getattr(msg, 'temperature', 273.15)
                motor_temp_k = getattr(msg, 'motor_temperature', 273.15)

                esc_data = {
                    'rpm': rpm_raw,
                    'voltage_v': getattr(msg, 'voltage', 0),
                    'current_a': getattr(msg, 'current', 0),
                    'temperature_c': esc_temp_k - 273.15,
                    'motor_temperature_c': motor_temp_k - 273.15,
                    'power_rating_pct': getattr(msg, 'power_rating_pct', 0),
                    'error_count': getattr(msg, 'error_count', 0),
                    'timestamp': datetime.now().isoformat()
                }

                with self.telemetry_lock:
                    self.arm_escs[arm_id] = esc_data

                if self.debug:
                    self.logger.debug(f"[UAVCAN] ESC Arm{arm_id}: RPM={rpm_raw} T={esc_data['temperature_c']:.0f}C V={esc_data['voltage_v']:.1f}V I={esc_data['current_a']:.1f}A")

            node.add_handler(dronecan.uavcan.equipment.power.BatteryInfo, battery_callback)
            node.add_handler(dronecan.uavcan.equipment.esc.Status, esc_status_callback)

            while not self.stop_event.is_set():
                try:
                    node.spin(timeout=0.1)
                except Exception as e:
                    if self.debug:
                        self.logger.debug(f"[UAVCAN] Spin error: {e}")

        except Exception as e:
            self.logger.error(f"[UAVCAN] Error: {e}")
        finally:
            self.logger.info("[UAVCAN] Worker stopped")

    # =========================================================================
    # Telemetry Assembly & HTTP Forwarding
    # =========================================================================

    def assemble_arms_data(self):
        """
        Assemble per-arm data array from collected BMS and ESC data.
        Returns list of 6 arm objects matching the Caribou Hub ArmData interface:
            { motorId, rpm, motor_temp_c, esc_temp_c, esc_voltage_v, esc_current_a, bat_temp_c, bat_soc_pct }
        """
        arms = []
        for arm_id in range(1, 7):
            bms = self.arm_batteries.get(arm_id, {})
            esc = self.arm_escs.get(arm_id, {})

            arm_data = {
                'motorId': arm_id,
                'rpm': esc.get('rpm', 0),
                'motor_temp_c': round(esc.get('motor_temperature_c', 0), 1),
                'esc_temp_c': round(esc.get('temperature_c', 0), 1),
                'esc_voltage_v': round(esc.get('voltage_v', 0), 1),
                'esc_current_a': round(esc.get('current_a', 0), 1),
                'bat_temp_c': round(bms.get('temperature_c', 0), 1),
                'bat_soc_pct': round(bms.get('soc_pct', 0), 1),
            }
            arms.append(arm_data)

        return arms

    def assemble_battery_uavcan(self):
        """
        Assemble aggregated battery_uavcan object for legacy compatibility.
        Uses lowest SoC (conservative) and total current across all arms.
        """
        if not self.arm_batteries:
            return None

        voltages = [b['voltage_v'] for b in self.arm_batteries.values()]
        currents = [b['current_a'] for b in self.arm_batteries.values()]
        temps = [b['temperature_k'] for b in self.arm_batteries.values() if b.get('temperature_k', 0) > 0]
        socs = [b['soc_pct'] for b in self.arm_batteries.values()]

        return {
            'battery_id': 0,
            'voltage_v': round(sum(voltages) / len(voltages), 2) if voltages else 0,
            'current_a': round(sum(currents), 2),
            'temperature_k': round(sum(temps) / len(temps), 1) if temps else 273.15,
            'state_of_charge_pct': round(min(socs), 1) if socs else 0,
            'timestamp': datetime.now().isoformat()
        }

    async def send_telemetry_periodic(self):
        """Periodically assemble full telemetry payload and queue for HTTP send."""
        while not self.stop_event.is_set():
            try:
                with self.telemetry_lock:
                    arms_data = self.assemble_arms_data()
                    battery_uavcan = self.assemble_battery_uavcan()

                    telemetry = {
                        # Flight controller data (cockpit HUD)
                        'attitude': self.telemetry_data.get('attitude'),
                        'position': self.telemetry_data.get('position'),
                        'gps': self.telemetry_data.get('gps'),
                        'battery_fc': self.telemetry_data.get('battery_fc'),
                        'in_air': self.telemetry_data.get('in_air', False),
                        'flight_mode': self.telemetry_data.get('flight_mode'),
                        'airspeed_ms': self.telemetry_data.get('airspeed_ms'),
                        'vertical_speed_ms': self.telemetry_data.get('vertical_speed_ms'),
                        'heading_deg': self.telemetry_data.get('heading_deg'),
                        # Legacy aggregated battery (for data cards)
                        'battery_uavcan': battery_uavcan,
                        # Per-arm data (structural view)
                        'arms': arms_data if any(self.arm_batteries.values()) or any(self.arm_escs.values()) else None,
                    }

                payload = {
                    'api_key': self.api_key,
                    'drone_id': self.drone_id,
                    'timestamp': datetime.now().isoformat(),
                    'telemetry': telemetry
                }

                try:
                    self.http_queue.put_nowait(payload)
                except:
                    if self.debug:
                        self.logger.debug("[SEND] Queue full, dropping packet")

                await asyncio.sleep(self.update_interval)

            except Exception as e:
                if self.debug:
                    self.logger.debug(f"[SEND] Error: {e}")

    def mavlink_worker(self):
        """Thread wrapper for async MAVLink worker."""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(self.mavlink_worker_async())
        finally:
            loop.close()

    def http_worker(self):
        """Worker thread that sends HTTP requests to Caribou Hub."""
        self.logger.info("[HTTP] Worker started")

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        async def send_loop():
            timeout = aiohttp.ClientTimeout(total=5)
            connector = aiohttp.TCPConnector(limit=4, keepalive_timeout=30)
            async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
                while not self.stop_event.is_set():
                    try:
                        try:
                            payload = self.http_queue.get(timeout=0.05)
                        except Empty:
                            await asyncio.sleep(0.01)
                            continue

                        rest_url = f"{self.web_server_url}/api/rest/telemetry/ingest"

                        async with session.post(rest_url, json=payload) as response:
                            if response.status == 200:
                                self.send_count += 1
                                if self.send_count % 50 == 0:
                                    self.logger.info(f"[HTTP] Sent {self.send_count} packets")
                            else:
                                error_text = await response.text()
                                self.logger.warning(f"[HTTP] {response.status}: {error_text[:200]}")

                    except asyncio.TimeoutError:
                        self.logger.warning("[HTTP] Timeout")
                    except Exception as e:
                        self.logger.error(f"[HTTP] Error: {e}")
                        await asyncio.sleep(1)

        try:
            loop.run_until_complete(send_loop())
        finally:
            loop.close()
            self.logger.info("[HTTP] Worker stopped")

    # =========================================================================
    # Lifecycle
    # =========================================================================

    def start(self):
        """Start all worker threads."""
        self.logger.info("=" * 60)
        self.logger.info("  Caribou Hub Telemetry Forwarder")
        self.logger.info("=" * 60)
        self.logger.info(f"  Server URL:     {self.web_server_url}")
        self.logger.info(f"  Drone ID:       {self.drone_id}")
        self.logger.info(f"  MAVLink URL:    {self.mavlink_url}")
        self.logger.info(f"  CAN Interface:  {self.can_interface}")
        self.logger.info(f"  Update Rate:    {UPDATE_RATE_HZ} Hz")
        self.logger.info(f"  Arms:           6 (independent motor/ESC/battery)")
        self.logger.info(f"  BMS Node IDs:   {list(ARM_BMS_NODE_IDS.keys())}")
        self.logger.info(f"  ESC Node IDs:   {list(ARM_ESC_NODE_IDS.keys())}")
        self.logger.info("=" * 60)

        self.mavlink_thread = threading.Thread(target=self.mavlink_worker, daemon=True)
        self.uavcan_thread = threading.Thread(target=self.uavcan_worker, daemon=True)
        self.http_thread = threading.Thread(target=self.http_worker, daemon=True)

        self.mavlink_thread.start()
        self.uavcan_thread.start()
        self.http_thread.start()

        self.logger.info("All workers started")

        try:
            while True:
                asyncio.run(asyncio.sleep(1))
        except KeyboardInterrupt:
            self.logger.info("\nShutting down...")
            self.stop()

    def stop(self):
        """Stop all worker threads gracefully."""
        self.stop_event.set()

        if self.mavlink_thread:
            self.mavlink_thread.join(timeout=2)
        if self.uavcan_thread:
            self.uavcan_thread.join(timeout=2)
        if self.http_thread:
            self.http_thread.join(timeout=2)

        self.logger.info(f"Final stats: {self.send_count} packets sent")
        self.logger.info("Shutdown complete")


def main():
    parser = argparse.ArgumentParser(description='Caribou Hub Telemetry Forwarder')
    parser.add_argument('--debug', action='store_true', help='Enable debug logging')
    args = parser.parse_args()

    forwarder = TelemetryForwarder(debug=args.debug)
    forwarder.start()


if __name__ == '__main__':
    main()
