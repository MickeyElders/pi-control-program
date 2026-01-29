# Pump Relay Control

Minimal local web UI to switch a GPIO-driven opto-coupled relay on/off.

## Quick start (Raspberry Pi)
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Configure if needed
export RELAY_PINS=27,22,23,10
export RELAY_ACTIVE_LOW=1
export TANK_LEVELS=72,58,46
export TANK_TEMPS=32.5,22.0,45.0
export TANK_PHS=6.8,7.2,6.5

uvicorn app:app --host 0.0.0.0 --port 8000
```

Open `http://<raspberrypi-ip>:8000`.

## Config
- `RELAY_PINS` (default `27,22,23,10`): comma-separated BCM pins.
- `RELAY_GPIO`: optional single BCM pin (used only when `RELAY_PINS` is not set).
- `RELAY_ACTIVE_LOW` (default `1`): set to `1` for low-level trigger, `0` for high-level trigger.
- `TANK_LEVELS` (default `72,58,46`): soak/fresh/heat water level percentages.
- `TANK_TEMPS` (default `32.5,22.0,45.0`): soak/fresh/heat temperatures (C).
- `TANK_PHS` (default `6.8,7.2,6.5`): soak/fresh/heat pH values.
- `GPIOZERO_PIN_FACTORY` (default `lgpio`): GPIO backend (`lgpio` or `rpi`).

## Systemd + Make automation
Install and start the service (will check and install system deps):
```bash
make install SERVICE_USER=pi WORKDIR=/home/pi/pi-control-program RELAY_PINS=27,22,23,10 RELAY_ACTIVE_LOW=1 TANK_LEVELS=72,58,46 TANK_TEMPS=32.5,22.0,45.0 TANK_PHS=6.8,7.2,6.5 PIN_FACTORY=lgpio
```

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
