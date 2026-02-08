import os
import threading
import time
from typing import List, Optional

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

try:
    import serial
except ImportError:
    serial = None

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

PH_METER_ENABLED = os.getenv("PH_METER_ENABLED", "1").lower() in {"1", "true", "yes", "on"}
PH_METER_PORT = os.getenv("PH_METER_PORT", "/dev/ttyUSB0")
PH_METER_ADDR = int(os.getenv("PH_METER_ADDR", "1"))
PH_METER_BAUD = int(os.getenv("PH_METER_BAUD", "9600"))
PH_METER_TIMEOUT = float(os.getenv("PH_METER_TIMEOUT", "0.8"))
PH_POLL_INTERVAL = float(os.getenv("PH_POLL_INTERVAL", "2.0"))
PH_STALE_SEC = float(os.getenv("PH_STALE_SEC", "10"))


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


def crc16_modbus(data: bytes) -> int:
    crc = 0xFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            if crc & 1:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc >>= 1
    return crc & 0xFFFF


def build_modbus_request(addr: int, start: int = 0, count: int = 2) -> bytes:
    payload = bytes([addr, 0x03, (start >> 8) & 0xFF, start & 0xFF, (count >> 8) & 0xFF, count & 0xFF])
    crc = crc16_modbus(payload)
    return payload + bytes([crc & 0xFF, (crc >> 8) & 0xFF])


def parse_modbus_response(resp: bytes, addr: int) -> Optional[tuple[float, float]]:
    if len(resp) != 9:
        return None
    if resp[0] != addr or resp[1] != 0x03 or resp[2] != 0x04:
        return None
    crc_expected = crc16_modbus(resp[:-2])
    crc_actual = resp[-2] | (resp[-1] << 8)
    if crc_expected != crc_actual:
        return None
    ph_raw = (resp[3] << 8) | resp[4]
    temp_raw = (resp[5] << 8) | resp[6]
    return ph_raw / 100.0, temp_raw / 10.0


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

auto_switches = {"fresh": False, "heat": False}

soak_lock = threading.Lock()
soak_ph_live: Optional[float] = None
soak_temp_live: Optional[float] = None
soak_last_good = 0.0


def ph_reader_loop() -> None:
    if not serial or not PH_METER_ENABLED:
        return
    global soak_ph_live, soak_temp_live, soak_last_good
    while True:
        try:
            with serial.Serial(
                PH_METER_PORT,
                PH_METER_BAUD,
                timeout=PH_METER_TIMEOUT,
            ) as ser:
                while True:
                    request = build_modbus_request(PH_METER_ADDR, 0, 2)
                    try:
                        ser.reset_input_buffer()
                    except Exception:
                        pass
                    ser.write(request)
                    ser.flush()
                    response = ser.read(9)
                    parsed = parse_modbus_response(response, PH_METER_ADDR)
                    if parsed:
                        ph_value, temp_value = parsed
                        with soak_lock:
                            soak_ph_live = round(ph_value, 2)
                            soak_temp_live = round(temp_value, 1)
                            soak_last_good = time.time()
                    time.sleep(PH_POLL_INTERVAL)
        except Exception:
            time.sleep(max(1.0, PH_POLL_INTERVAL))


def get_soak_reading() -> tuple[Optional[float], Optional[float]]:
    with soak_lock:
        ph_value = soak_ph_live
        temp_value = soak_temp_live
        last_good = soak_last_good
    if last_good and (time.time() - last_good) <= PH_STALE_SEC:
        return temp_value, ph_value
    return None, None


def build_tank_colors(soak_temp: Optional[float], soak_ph: Optional[float]) -> dict:
    soak_temp_color = soak_temp if soak_temp is not None else tank_temps["soak"]
    soak_ph_color = soak_ph if soak_ph is not None else tank_phs["soak"]
    return {
        "soak": color_for_ph_temp(soak_ph_color, soak_temp_color),
        "fresh": color_for_ph_temp(tank_phs["fresh"], tank_temps["fresh"]),
        "heat": color_for_ph_temp(tank_phs["heat"], tank_temps["heat"]),
    }


def set_lift_state(state: str) -> None:
    global lift_state
    if state not in {"up", "down", "stop"}:
        raise ValueError("Invalid lift state.")
    if state == "up":
        if lift_state == "down":
            raise ValueError("Lift is moving down.")
        if lift_state == "up":
            lift_up.off()
            lift_state = "stop"
        else:
            lift_down.off()
            lift_up.on()
            lift_state = "up"
    elif state == "down":
        if lift_state == "up":
            raise ValueError("Lift is moving up.")
        if lift_state == "down":
            lift_down.off()
            lift_state = "stop"
        else:
            lift_up.off()
            lift_down.on()
            lift_state = "down"
    else:
        lift_up.off()
        lift_down.off()
        lift_state = "stop"

app = FastAPI(title="Pump Relay Control")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


@app.on_event("startup")
def start_ph_reader() -> None:
    if PH_METER_ENABLED and serial:
        thread = threading.Thread(target=ph_reader_loop, daemon=True)
        thread.start()


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
    soak_temp, soak_ph = get_soak_reading()
    tank_colors = build_tank_colors(soak_temp, soak_ph)
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
            "soak_temp": soak_temp,
            "soak_ph": soak_ph,
            "tank_colors": tank_colors,
            "auto_switches": auto_switches,
            "heater": {"configured": True, "on": heater.is_active},
        },
    )


@app.get("/api/status")
def api_status() -> dict:
    auto_status = {"fresh": auto_switches["fresh"], "heat": auto_switches["heat"], "configured": True}
    soak_temp, soak_ph = get_soak_reading()
    tank_colors = build_tank_colors(soak_temp, soak_ph)
    return {
        "relays": [
            {"index": 0, "pin": PIN_PUMP1, "on": pump1.is_active},
            {"index": 1, "pin": PIN_PUMP2, "on": pump2.is_active},
            {"index": 2, "pin": PIN_PUMP3, "on": pump3.is_active},
        ],
        "auto": auto_status,
        "lift": {"configured": True, "state": lift_state},
        "heater": {"configured": True, "on": heater.is_active},
        "tank": {
            "soak": {
                "temp": soak_temp,
                "ph": soak_ph,
                "color": list(tank_colors["soak"]),
            }
        },
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
