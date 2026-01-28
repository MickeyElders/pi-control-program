# Pump Relay Control

Minimal local web UI to switch a GPIO-driven opto-coupled relay on/off.

## Quick start (Raspberry Pi)
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Configure if needed
export RELAY_GPIO=17
export RELAY_ACTIVE_LOW=1

uvicorn app:app --host 0.0.0.0 --port 8000
```

Open `http://<raspberrypi-ip>:8000`.

## Config
- `RELAY_GPIO` (default `17`): GPIO pin number.
- `RELAY_ACTIVE_LOW` (default `1`): set to `1` for low-level trigger, `0` for high-level trigger.

## Systemd + Make automation
Install system deps (once):
```bash
make deps
```

Install and start the service:
```bash
make install SERVICE_USER=pi WORKDIR=/home/pi/pi-control-program RELAY_GPIO=17 RELAY_ACTIVE_LOW=1
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

## Remote access
Use a VPN (Tailscale/ZeroTier) and access the same local URL over the VPN.

## Local dev without GPIO hardware
If you need to run this on a non-Pi machine, set:
```bash
export GPIOZERO_PIN_FACTORY=mock
```
