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
- GPIO pins are hardcoded in `app.py`:
  `PIN_PUMP1=4`, `PIN_PUMP2=14`, `PIN_PUMP3=15`,
  `PIN_VALVE_FRESH=17`, `PIN_VALVE_HEAT=18`, `PIN_HEATER=27`,
  `PIN_LIFT_UP=22`, `PIN_LIFT_DOWN=24` (BCM numbering).
- To change pins, edit `app.py` directly.
- `RELAY_ACTIVE_LOW` (default `1`): set to `1` for low-level trigger, `0` for high-level trigger.
- `TANK_LEVELS` (default `72,58,46`): soak/fresh/heat water level percentages.
- `TANK_TEMPS` (default `32.5,22.0,45.0`): soak/fresh/heat temperatures (C).
- `TANK_PHS` (default `6.8,7.2,6.5`): soak/fresh/heat pH values.
- `GPIO_BACKEND` (default auto): `jetson`, `rpigpio`, or `gpiozero`.
- `PIN_MODE` (default `BOARD`): pin numbering for Jetson/RPi.GPIO (`BOARD` or `BCM`).
- `GPIOZERO_PIN_FACTORY` (default `lgpio`): GPIO backend (`lgpio` or `rpi`).
- PH meter (Modbus RTU over USB / CH340):
  - `PH_METER_ENABLED` (default `1`)
  - `PH_METER_PORT` (default `/dev/ttyUSB0`)
  - `PH_METER_ADDR` (default `1`)
  - `PH_METER_BAUD` (default `9600`)
  - `PH_METER_TIMEOUT` (default `0.8`)
  - `PH_POLL_INTERVAL` (default `2.0`)
  - `PH_STALE_SEC` (default `10`)

## Systemd + Make automation
Install and start the service (will check and install system deps):
```bash
make install SERVICE_USER=pi WORKDIR=/home/pi/pi-control-program RELAY_ACTIVE_LOW=1 TANK_LEVELS=72,58,46 TANK_TEMPS=32.5,22.0,45.0 TANK_PHS=6.8,7.2,6.5 PIN_FACTORY=lgpio
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

Pins are hardcoded in `app.py`; edit them if you want to use this mapping on Jetson.

Note: Jetson GPIO outputs **3.3V only**. If your relay board needs a 5V control signal, use a level shifter/transistor or a 3.3V-compatible relay input.

## Raspberry Pi (BOARD numbering)
If you wire by physical pin numbers (e.g. 7/11/13), use RPi.GPIO and BOARD mode:
```bash
export GPIO_BACKEND=rpigpio
export PIN_MODE=BOARD
```
Pins are hardcoded in `app.py` (BCM). Edit the constants if you need different pins.

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
