# Pump Relay Control

Minimal local web UI to switch a GPIO-driven opto-coupled relay on/off.

## Quick start (Raspberry Pi)
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Configure if needed
export RELAY_PINS=27,22,23
export RELAY_ACTIVE_LOW=1
export TANK_LEVELS=72,58,46
export TANK_TEMPS=32.5,22.0,45.0
export TANK_PHS=6.8,7.2,6.5
export HEATER_GPIO=5

uvicorn app:app --host 0.0.0.0 --port 8000
```

Open `http://<raspberrypi-ip>:8000`.

## Config
- `RELAY_PINS` (default `27,22,23`): comma-separated BCM pins.
- `RELAY_GPIO`: optional single BCM pin (used only when `RELAY_PINS` is not set).
- `RELAY_ACTIVE_LOW` (default `1`): set to `1` for low-level trigger, `0` for high-level trigger.
- `VALVE_PINS`: optional two pins for pump3 valves (format `pin_fresh,pin_heat`).
- `VALVE_GPIO_FRESH` / `VALVE_GPIO_HEAT`: optional separate valve pins (used when `VALVE_PINS` is not set).
- `VALVE_ACTIVE_LOW`: optional trigger polarity for valves (defaults to `RELAY_ACTIVE_LOW`).
- `LIFT_PINS`: optional two pins for lift up/down (format `pin_up,pin_down`).
- `LIFT_UP_GPIO` / `LIFT_DOWN_GPIO`: optional separate lift pins (used when `LIFT_PINS` is not set).
- `LIFT_ACTIVE_LOW`: optional trigger polarity for lift (defaults to `RELAY_ACTIVE_LOW`).
- `TANK_LEVELS` (default `72,58,46`): soak/fresh/heat water level percentages.
- `TANK_TEMPS` (default `32.5,22.0,45.0`): soak/fresh/heat temperatures (C).
- `TANK_PHS` (default `6.8,7.2,6.5`): soak/fresh/heat pH values.
- `HEATER_GPIO`: optional BCM pin for heater relay.
- `HEATER_ACTIVE_LOW`: optional trigger polarity for heater (defaults to `RELAY_ACTIVE_LOW`).
- `GPIO_BACKEND` (default auto): `jetson`, `rpigpio`, or `gpiozero`.
- `PIN_MODE` (default `BOARD`): pin numbering for Jetson/RPi.GPIO (`BOARD` or `BCM`).
- `GPIOZERO_PIN_FACTORY` (default `lgpio`): GPIO backend (`lgpio` or `rpi`).

## Systemd + Make automation
Install and start the service (will check and install system deps):
```bash
make install SERVICE_USER=pi WORKDIR=/home/pi/pi-control-program RELAY_PINS=27,22,23 RELAY_ACTIVE_LOW=1 TANK_LEVELS=72,58,46 TANK_TEMPS=32.5,22.0,45.0 TANK_PHS=6.8,7.2,6.5 HEATER_GPIO=5 PIN_FACTORY=lgpio
```

## Jetson notes
For Jetson, install the GPIO library and use physical pin numbering:
```bash
sudo apt install -y python3-jetson-gpio
export GPIO_BACKEND=jetson
export PIN_MODE=BOARD
```

Suggested Jetson Nano 40-pin mapping (BOARD pins):
- Pump1: 7
- Pump2: 11
- Pump3: 13
- Valve1 (soak -> fresh): 15
- Valve2 (soak -> heat): 16
- Heater: 18
- Lift up: 19
- Lift down: 21

Example:
```bash
export RELAY_PINS=7,11,13
export VALVE_PINS=15,16
export HEATER_GPIO=18
export LIFT_PINS=19,21
```

Note: Jetson GPIO outputs **3.3V only**. If your relay board needs a 5V control signal, use a level shifter/transistor or a 3.3V-compatible relay input.

## Raspberry Pi (BOARD numbering)
If you wire by physical pin numbers (e.g. 7/11/13), use RPi.GPIO and BOARD mode:
```bash
export GPIO_BACKEND=rpigpio
export PIN_MODE=BOARD
export RELAY_PINS=7,11,13
```
If you prefer BCM numbering, keep the defaults and omit `GPIO_BACKEND`/`PIN_MODE`.

Reinstall / uninstall:
```bash
make reinstall
make uninstall
```

Status / logs:
```bash
make status
make logs
```

Notes:
- Newer Raspberry Pi OS (bookworm) uses `lgpio`; older versions may need `PIN_FACTORY=rpi`.
- `make install` creates a venv with `--system-site-packages` so it can access the system GPIO backend modules.

## Remote access
Use a VPN (Tailscale/ZeroTier) and access the same local URL over the VPN.

## Local dev without GPIO hardware
If you need to run this on a non-Pi machine, set:
```bash
export GPIOZERO_PIN_FACTORY=mock
```
