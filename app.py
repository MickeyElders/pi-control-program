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
DEFAULT_TEMPS = [32.5, 22.0, 45.0]
DEFAULT_PHS = [6.8, 7.2, 6.5]
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


def clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def lerp_color(color_a: tuple[int, int, int], color_b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return (
        int(lerp(color_a[0], color_b[0], t)),
        int(lerp(color_a[1], color_b[1], t)),
        int(lerp(color_a[2], color_b[2], t)),
    )


def ph_to_color(ph: float) -> tuple[int, int, int]:
    ph = clamp(ph, 0.0, 14.0)
    acidic = (210, 74, 74)
    neutral = (88, 168, 140)
    alkaline = (76, 120, 208)
    if ph <= 7.0:
        return lerp_color(acidic, neutral, ph / 7.0)
    return lerp_color(neutral, alkaline, (ph - 7.0) / 7.0)


def temp_adjust(color: tuple[int, int, int], temp_c: float) -> tuple[int, int, int]:
    warm = (226, 124, 54)
    cool = (70, 130, 210)
    delta = clamp((temp_c - 25.0) / 20.0, -1.0, 1.0)
    if delta >= 0:
        return lerp_color(color, warm, delta * 0.6)
    return lerp_color(color, cool, -delta * 0.6)


def color_for_ph_temp(ph: float, temp_c: float) -> tuple[int, int, int]:
    return temp_adjust(ph_to_color(ph), temp_c)


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


def parse_float_values(value: str, count: int, defaults: List[float]) -> List[float]:
    values: List[float] = []
    for part in value.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            values.append(float(part))
        except ValueError:
            continue
    while len(values) < count:
        values.append(defaults[len(values)])
    return values[:count]


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

temps_env = os.getenv("TANK_TEMPS", "")
tank_temps_list = parse_float_values(temps_env, 3, DEFAULT_TEMPS) if temps_env else DEFAULT_TEMPS[:]
tank_temps = {"soak": tank_temps_list[0], "fresh": tank_temps_list[1], "heat": tank_temps_list[2]}

ph_env = os.getenv("TANK_PHS", "")
tank_phs_list = parse_float_values(ph_env, 3, DEFAULT_PHS) if ph_env else DEFAULT_PHS[:]
tank_phs = {"soak": tank_phs_list[0], "fresh": tank_phs_list[1], "heat": tank_phs_list[2]}
tank_colors = {
    "soak": color_for_ph_temp(tank_phs["soak"], tank_temps["soak"]),
    "fresh": color_for_ph_temp(tank_phs["fresh"], tank_temps["fresh"]),
    "heat": color_for_ph_temp(tank_phs["heat"], tank_temps["heat"]),
}

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
            "tank_temps": tank_temps,
            "tank_phs": tank_phs,
            "tank_colors": tank_colors,
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
