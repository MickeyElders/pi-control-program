import os
import time
from typing import List

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

try:
    import Jetson.GPIO as JetsonGPIO
except ImportError:
    JetsonGPIO = None

try:
    import RPi.GPIO as RPiGPIO
except ImportError:
    RPiGPIO = None

try:
    from gpiozero import DigitalOutputDevice as GpiozeroDigitalOutputDevice
except ImportError:
    GpiozeroDigitalOutputDevice = None

GPIO_BACKEND = os.getenv("GPIO_BACKEND", "auto").lower()
PIN_MODE = os.getenv("PIN_MODE", "BOARD").upper()

if GPIO_BACKEND in {"jetson", "jetson-gpio"}:
    if not JetsonGPIO:
        raise RuntimeError("GPIO_BACKEND=jetson requires Jetson.GPIO to be installed.")
    BACKEND = "jetson"
elif GPIO_BACKEND in {"rpigpio", "rpi", "raspi", "raspberrypi"}:
    if not RPiGPIO:
        raise RuntimeError("GPIO_BACKEND=rpigpio requires RPi.GPIO to be installed.")
    BACKEND = "rpigpio"
elif GPIO_BACKEND in {"gpiozero"}:
    if not GpiozeroDigitalOutputDevice:
        raise RuntimeError("GPIO_BACKEND=gpiozero requires gpiozero to be installed.")
    BACKEND = "gpiozero"
else:
    if JetsonGPIO:
        BACKEND = "jetson"
    elif RPiGPIO:
        BACKEND = "rpigpio"
    elif GpiozeroDigitalOutputDevice:
        BACKEND = "gpiozero"
    else:
        BACKEND = "stub"


class JetsonOutputDevice:
    def __init__(self, pin: int, active_low: bool = False, initial_value: bool = False) -> None:
        self.pin = pin
        self.active_low = active_low
        self._is_active = bool(initial_value)
        if PIN_MODE == "BCM":
            JetsonGPIO.setmode(JetsonGPIO.BCM)
        else:
            JetsonGPIO.setmode(JetsonGPIO.BOARD)
        JetsonGPIO.setwarnings(False)
        level = JetsonGPIO.HIGH if (initial_value ^ active_low) else JetsonGPIO.LOW
        JetsonGPIO.setup(pin, JetsonGPIO.OUT, initial=level)

    def on(self) -> None:
        JetsonGPIO.output(self.pin, JetsonGPIO.LOW if self.active_low else JetsonGPIO.HIGH)
        self._is_active = True

    def off(self) -> None:
        JetsonGPIO.output(self.pin, JetsonGPIO.HIGH if self.active_low else JetsonGPIO.LOW)
        self._is_active = False

    @property
    def is_active(self) -> bool:
        return self._is_active

    @property
    def value(self) -> int:
        return 1 if self._is_active else 0

    def close(self) -> None:
        JetsonGPIO.cleanup(self.pin)


class RpiOutputDevice:
    def __init__(self, pin: int, active_low: bool = False, initial_value: bool = False) -> None:
        self.pin = pin
        self.active_low = active_low
        self._is_active = bool(initial_value)
        if PIN_MODE == "BCM":
            RPiGPIO.setmode(RPiGPIO.BCM)
        else:
            RPiGPIO.setmode(RPiGPIO.BOARD)
        RPiGPIO.setwarnings(False)
        level = RPiGPIO.HIGH if (initial_value ^ active_low) else RPiGPIO.LOW
        RPiGPIO.setup(pin, RPiGPIO.OUT, initial=level)

    def on(self) -> None:
        RPiGPIO.output(self.pin, RPiGPIO.LOW if self.active_low else RPiGPIO.HIGH)
        self._is_active = True

    def off(self) -> None:
        RPiGPIO.output(self.pin, RPiGPIO.HIGH if self.active_low else RPiGPIO.LOW)
        self._is_active = False

    @property
    def is_active(self) -> bool:
        return self._is_active

    @property
    def value(self) -> int:
        return 1 if self._is_active else 0

    def close(self) -> None:
        RPiGPIO.cleanup(self.pin)


class GpiozeroOutputDevice:
    def __init__(self, pin: int, active_low: bool = False, initial_value: bool = False) -> None:
        self.device = GpiozeroDigitalOutputDevice(
            pin, active_high=not active_low, initial_value=initial_value
        )
        self.pin = pin

    def on(self) -> None:
        self.device.on()

    def off(self) -> None:
        self.device.off()

    @property
    def is_active(self) -> bool:
        return self.device.is_active

    @property
    def value(self) -> int:
        return self.device.value

    def close(self) -> None:
        self.device.close()


class StubOutputDevice:
    def __init__(self, pin: int, active_low: bool = False, initial_value: bool = False) -> None:
        self.pin = pin
        self.active_low = active_low
        self._is_active = bool(initial_value)

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


def create_output_device(pin: int, active_low: bool, initial_value: bool = False):
    if BACKEND == "jetson":
        return JetsonOutputDevice(pin, active_low=active_low, initial_value=initial_value)
    if BACKEND == "rpigpio":
        return RpiOutputDevice(pin, active_low=active_low, initial_value=initial_value)
    if BACKEND == "gpiozero":
        return GpiozeroOutputDevice(pin, active_low=active_low, initial_value=initial_value)
    return StubOutputDevice(pin, active_low=active_low, initial_value=initial_value)


DEFAULT_LEVELS = [72, 58, 46]
DEFAULT_TEMPS = [32.5, 22.0, 45.0]
DEFAULT_PHS = [6.8, 7.2, 6.5]
ACTIVE_LOW = os.getenv("RELAY_ACTIVE_LOW", "1").lower() in {"1", "true", "yes", "on"}

PIN_PUMP1 = 4
PIN_PUMP2 = 14
PIN_PUMP3 = 15
PIN_VALVE_FRESH = 17
PIN_VALVE_HEAT = 18
PIN_HEATER = 27
PIN_LIFT_UP = 22
PIN_LIFT_DOWN = 24
LIFT_PULSE_SEC = 0.3


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


pump1 = create_output_device(PIN_PUMP1, active_low=ACTIVE_LOW, initial_value=False)
pump2 = create_output_device(PIN_PUMP2, active_low=ACTIVE_LOW, initial_value=False)
pump3 = create_output_device(PIN_PUMP3, active_low=ACTIVE_LOW, initial_value=False)
for pump in (pump1, pump2, pump3):
    pump.off()

valve_fresh = create_output_device(PIN_VALVE_FRESH, active_low=ACTIVE_LOW, initial_value=False)
valve_heat = create_output_device(PIN_VALVE_HEAT, active_low=ACTIVE_LOW, initial_value=False)
valve_fresh.off()
valve_heat.off()

lift_up = create_output_device(PIN_LIFT_UP, active_low=ACTIVE_LOW, initial_value=False)
lift_down = create_output_device(PIN_LIFT_DOWN, active_low=ACTIVE_LOW, initial_value=False)
lift_up.off()
lift_down.off()
lift_state = "stop"

heater = create_output_device(PIN_HEATER, active_low=ACTIVE_LOW, initial_value=False)
heater.off()

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

auto_switches = {"fresh": False, "heat": False}


def set_lift_state(state: str) -> None:
    global lift_state
    if state not in {"up", "down", "stop"}:
        raise ValueError("Invalid lift state.")
    if state == "up":
        lift_down.off()
        lift_up.on()
        time.sleep(LIFT_PULSE_SEC)
        lift_up.off()
    elif state == "down":
        lift_up.off()
        lift_down.on()
        time.sleep(LIFT_PULSE_SEC)
        lift_down.off()
    else:
        lift_up.off()
        lift_down.off()
    lift_state = "stop" if state == "stop" else state

app = FastAPI(title="Pump Relay Control")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


class RelayCommand(BaseModel):
    index: int
    on: bool


class AutoSwitchCommand(BaseModel):
    which: str
    on: bool


class HeaterCommand(BaseModel):
    on: bool


class LiftCommand(BaseModel):
    state: str


@app.get("/", response_class=HTMLResponse)
def index(request: Request) -> HTMLResponse:
    pumps = [
        {"index": 0, "pin": PIN_PUMP1, "on": pump1.is_active},
        {"index": 1, "pin": PIN_PUMP2, "on": pump2.is_active},
        {"index": 2, "pin": PIN_PUMP3, "on": pump3.is_active},
    ]
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "pumps": pumps,
            "tank_levels": tank_levels,
            "tank_temps": tank_temps,
            "tank_phs": tank_phs,
            "tank_colors": tank_colors,
            "auto_switches": auto_switches,
            "heater": {"configured": True, "on": heater.is_active},
        },
    )


@app.get("/api/status")
def api_status() -> dict:
    auto_status = {"fresh": auto_switches["fresh"], "heat": auto_switches["heat"], "configured": True}
    return {
        "relays": [
            {"index": 0, "pin": PIN_PUMP1, "on": pump1.is_active},
            {"index": 1, "pin": PIN_PUMP2, "on": pump2.is_active},
            {"index": 2, "pin": PIN_PUMP3, "on": pump3.is_active},
        ],
        "auto": auto_status,
        "lift": {"configured": True, "state": lift_state},
        "heater": {"configured": True, "on": heater.is_active},
    }


@app.post("/api/relay")
def api_relay(cmd: RelayCommand) -> dict:
    if cmd.index == 0:
        target = pump1
    elif cmd.index == 1:
        target = pump2
    elif cmd.index == 2:
        target = pump3
    else:
        raise HTTPException(status_code=400, detail="Invalid relay index.")
    if cmd.on:
        target.on()
    else:
        target.off()
    return {"on": target.is_active}


@app.post("/api/auto")
def api_auto(cmd: AutoSwitchCommand) -> dict:
    if cmd.which not in auto_switches:
        raise HTTPException(status_code=400, detail="Invalid auto switch.")
    auto_switches[cmd.which] = bool(cmd.on)
    if cmd.which == "fresh":
        if cmd.on:
            valve_fresh.on()
        else:
            valve_fresh.off()
    else:
        if cmd.on:
            valve_heat.on()
        else:
            valve_heat.off()

    return {"auto": {"fresh": auto_switches["fresh"], "heat": auto_switches["heat"], "configured": True}}


@app.post("/api/lift")
def api_lift(cmd: LiftCommand) -> dict:
    try:
        set_lift_state(cmd.state)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"configured": True, "state": lift_state}


@app.post("/api/heater")
def api_heater(cmd: HeaterCommand) -> dict:
    if cmd.on:
        heater.on()
    else:
        heater.off()
    return {"configured": True, "on": heater.is_active}


@app.get("/api/ping")
def api_ping() -> dict:
    return {"ok": True}
