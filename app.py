import os
from typing import List

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

try:
    from gpiozero import DigitalOutputDevice
except ImportError:
    class DigitalOutputDevice:  # Minimal stub for non-Pi dev/testing.
        def __init__(self, pin: int, active_high: bool = True, initial_value: bool = False) -> None:
            self._is_active = bool(initial_value)
            self.pin = pin
            self.active_high = active_high

        def on(self) -> None:
            self._is_active = True

        def off(self) -> None:
            self._is_active = False

        @property
        def is_active(self) -> bool:
            return self._is_active

        @property
        def value(self) -> int:
            return 1 if self._is_active else 0

        def close(self) -> None:
            return None


DEFAULT_PINS = "27,22,23,10"
DEFAULT_LEVELS = [72, 58, 46]
ACTIVE_LOW = os.getenv("RELAY_ACTIVE_LOW", "1").lower() in {"1", "true", "yes", "on"}


def parse_pins(value: str) -> List[int]:
    pins: List[int] = []
    for part in value.split(","):
        part = part.strip()
        if not part:
            continue
        pins.append(int(part))
    return pins


def clamp_level(value: int) -> int:
    return max(0, min(100, value))


def parse_levels(value: str, count: int, defaults: List[int]) -> List[int]:
    levels: List[int] = []
    for part in value.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            levels.append(clamp_level(int(float(part))))
        except ValueError:
            continue
    while len(levels) < count:
        levels.append(defaults[len(levels)])
    return levels[:count]


pins_env = os.getenv("RELAY_PINS")
if pins_env:
    PINS = parse_pins(pins_env)
else:
    relay_gpio = os.getenv("RELAY_GPIO")
    if relay_gpio:
        PINS = [int(relay_gpio)]
    else:
        PINS = parse_pins(DEFAULT_PINS)

if not PINS:
    raise RuntimeError("No relay pins configured. Set RELAY_PINS or RELAY_GPIO.")

relays = [DigitalOutputDevice(pin, active_high=not ACTIVE_LOW, initial_value=False) for pin in PINS]
for relay in relays:
    relay.off()

levels_env = os.getenv("TANK_LEVELS", "")
tank_levels_list = parse_levels(levels_env, 3, DEFAULT_LEVELS) if levels_env else DEFAULT_LEVELS[:]
tank_levels = {"soak": tank_levels_list[0], "fresh": tank_levels_list[1], "heat": tank_levels_list[2]}

app = FastAPI(title="Pump Relay Control")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


class RelayCommand(BaseModel):
    index: int
    on: bool


@app.get("/", response_class=HTMLResponse)
def index(request: Request) -> HTMLResponse:
    pumps = [
        {"index": idx, "pin": pin, "on": relays[idx].is_active} for idx, pin in enumerate(PINS)
    ]
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "pumps": pumps,
            "pins": PINS,
            "active_low": ACTIVE_LOW,
            "tank_levels": tank_levels,
        },
    )


@app.get("/api/status")
def api_status() -> dict:
    return {
        "relays": [
            {"index": idx, "pin": pin, "on": relays[idx].is_active}
            for idx, pin in enumerate(PINS)
        ]
    }


@app.post("/api/relay")
def api_relay(cmd: RelayCommand) -> dict:
    if cmd.index < 0 or cmd.index >= len(relays):
        raise HTTPException(status_code=400, detail="Invalid relay index.")
    if cmd.on:
        relays[cmd.index].on()
    else:
        relays[cmd.index].off()
    return {"on": relays[cmd.index].is_active}


@app.get("/api/ping")
def api_ping() -> dict:
    return {"ok": True}
