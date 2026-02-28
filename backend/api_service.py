import os
import shutil
import threading
import time
from typing import Optional, Tuple

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from .db_store import PersistenceStore
from .gpio_control import GPIOConfig, GPIOController

try:
    import serial
except ImportError:
    serial = None

DEFAULT_LEVELS = [72, 58, 46]
DEFAULT_TEMPS = [32.5, 22.0, 45.0]
DEFAULT_PHS = [6.8, 7.2, 6.5]

PH_METER_ENABLED = os.getenv("PH_METER_ENABLED", "1").lower() in {"1", "true", "yes", "on"}
PH_METER_PORT = os.getenv("PH_METER_PORT", "/dev/ttyUSB0")
PH_METER_ADDR = int(os.getenv("PH_METER_ADDR", "1"))
PH_METER_BAUD = int(os.getenv("PH_METER_BAUD", "9600"))
PH_METER_TIMEOUT = float(os.getenv("PH_METER_TIMEOUT", "0.8"))
PH_POLL_INTERVAL = float(os.getenv("PH_POLL_INTERVAL", "2.0"))
PH_STALE_SEC = float(os.getenv("PH_STALE_SEC", "10"))

PERSIST_SAMPLE_SEC = max(1.0, float(os.getenv("PERSIST_SAMPLE_SEC", "5")))
PERSIST_RETENTION_DAYS = max(1, int(os.getenv("PERSIST_RETENTION_DAYS", "30")))
DB_PATH = os.getenv("DATA_DB_PATH", os.path.join("data", "runtime.db"))
DB_BUSY_TIMEOUT_MS = int(os.getenv("DB_BUSY_TIMEOUT_MS", "5000"))


def clamp_level(value: int) -> int:
    return max(0, min(100, value))


def clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def lerp_color(color_a: Tuple[int, int, int], color_b: Tuple[int, int, int], t: float) -> Tuple[int, int, int]:
    return (
        int(lerp(color_a[0], color_b[0], t)),
        int(lerp(color_a[1], color_b[1], t)),
        int(lerp(color_a[2], color_b[2], t)),
    )


def ph_to_color(ph: float) -> Tuple[int, int, int]:
    ph = clamp(ph, 0.0, 14.0)
    acidic = (210, 74, 74)
    neutral = (88, 168, 140)
    alkaline = (76, 120, 208)
    if ph <= 7.0:
        return lerp_color(acidic, neutral, ph / 7.0)
    return lerp_color(neutral, alkaline, (ph - 7.0) / 7.0)


def temp_adjust(color: Tuple[int, int, int], temp_c: float) -> Tuple[int, int, int]:
    warm = (226, 124, 54)
    cool = (70, 130, 210)
    delta = clamp((temp_c - 25.0) / 20.0, -1.0, 1.0)
    if delta >= 0:
        return lerp_color(color, warm, delta * 0.6)
    return lerp_color(color, cool, -delta * 0.6)


def color_for_ph_temp(ph: float, temp_c: float) -> Tuple[int, int, int]:
    return temp_adjust(ph_to_color(ph), temp_c)


def parse_levels(value: str, count: int, defaults: list[int]) -> list[int]:
    levels = []
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


def parse_float_values(value: str, count: int, defaults: list[float]) -> list[float]:
    values = []
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


def parse_modbus_response(resp: bytes, addr: int) -> Optional[Tuple[float, float]]:
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


gpio = GPIOController(GPIOConfig())
store = PersistenceStore(DB_PATH, retention_days=PERSIST_RETENTION_DAYS, busy_timeout_ms=DB_BUSY_TIMEOUT_MS)

levels_env = os.getenv("TANK_LEVELS", "")
tank_levels_list = parse_levels(levels_env, 3, DEFAULT_LEVELS) if levels_env else DEFAULT_LEVELS[:]
tank_levels = {"soak": tank_levels_list[0], "fresh": tank_levels_list[1], "heat": tank_levels_list[2]}

temps_env = os.getenv("TANK_TEMPS", "")
tank_temps_list = parse_float_values(temps_env, 3, DEFAULT_TEMPS) if temps_env else DEFAULT_TEMPS[:]
tank_temps = {"soak": tank_temps_list[0], "fresh": tank_temps_list[1], "heat": tank_temps_list[2]}

ph_env = os.getenv("TANK_PHS", "")
tank_phs_list = parse_float_values(ph_env, 3, DEFAULT_PHS) if ph_env else DEFAULT_PHS[:]
tank_phs = {"soak": tank_phs_list[0], "fresh": tank_phs_list[1], "heat": tank_phs_list[2]}

soak_lock = threading.Lock()
soak_ph_live: Optional[float] = None
soak_temp_live: Optional[float] = None
soak_last_good = 0.0

cpu_lock = threading.Lock()
cpu_last_total: Optional[int] = None
cpu_last_idle: Optional[int] = None


def ph_reader_loop() -> None:
    if not serial or not PH_METER_ENABLED:
        return

    global soak_ph_live, soak_temp_live, soak_last_good
    while True:
        try:
            with serial.Serial(PH_METER_PORT, PH_METER_BAUD, timeout=PH_METER_TIMEOUT) as ser:
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


def get_soak_reading() -> Tuple[Optional[float], Optional[float]]:
    with soak_lock:
        ph_value = soak_ph_live
        temp_value = soak_temp_live
        last_good = soak_last_good
    if last_good and (time.time() - last_good) <= PH_STALE_SEC:
        return temp_value, ph_value
    return None, None


def get_cpu_percent() -> Optional[float]:
    global cpu_last_total, cpu_last_idle
    try:
        with open("/proc/stat", "r", encoding="utf-8") as f:
            first_line = f.readline().strip()
        parts = first_line.split()
        if len(parts) < 5 or parts[0] != "cpu":
            return None
        values = [int(v) for v in parts[1:]]
        idle = values[3] + (values[4] if len(values) > 4 else 0)
        total = sum(values)
    except Exception:
        return None

    with cpu_lock:
        if cpu_last_total is None or cpu_last_idle is None:
            cpu_last_total = total
            cpu_last_idle = idle
            return None
        total_delta = total - cpu_last_total
        idle_delta = idle - cpu_last_idle
        cpu_last_total = total
        cpu_last_idle = idle

    if total_delta <= 0:
        return None
    busy = (total_delta - idle_delta) / total_delta
    return round(clamp(busy * 100.0, 0.0, 100.0), 1)


def get_memory_percent() -> Optional[float]:
    try:
        total_kb = 0
        available_kb = 0
        with open("/proc/meminfo", "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    total_kb = int(line.split()[1])
                elif line.startswith("MemAvailable:"):
                    available_kb = int(line.split()[1])
                if total_kb and available_kb:
                    break
        if total_kb <= 0:
            return None
        used_ratio = (total_kb - available_kb) / total_kb
        return round(clamp(used_ratio * 100.0, 0.0, 100.0), 1)
    except Exception:
        return None


def get_disk_percent(path: str = "/") -> Optional[float]:
    try:
        usage = shutil.disk_usage(path)
        if usage.total <= 0:
            return None
        used_ratio = usage.used / usage.total
        return round(clamp(used_ratio * 100.0, 0.0, 100.0), 1)
    except Exception:
        return None


def get_cpu_temp() -> Optional[float]:
    thermal_path = "/sys/class/thermal/thermal_zone0/temp"
    try:
        with open(thermal_path, "r", encoding="utf-8") as f:
            raw = f.read().strip()
        return round(int(raw) / 1000.0, 1)
    except Exception:
        return None


def get_uptime_seconds() -> Optional[int]:
    try:
        with open("/proc/uptime", "r", encoding="utf-8") as f:
            raw = f.read().strip().split()[0]
        return int(float(raw))
    except Exception:
        return None


def get_system_status() -> dict:
    try:
        load1, load5, load15 = os.getloadavg()
    except Exception:
        load1, load5, load15 = (0.0, 0.0, 0.0)
    return {
        "host": os.uname().nodename,
        "gpio_backend": gpio.backend,
        "cpu_percent": get_cpu_percent(),
        "memory_percent": get_memory_percent(),
        "disk_percent": get_disk_percent("/"),
        "cpu_temp": get_cpu_temp(),
        "uptime_sec": get_uptime_seconds(),
        "load1": round(load1, 2),
        "load5": round(load5, 2),
        "load15": round(load15, 2),
    }


def build_tank_colors(soak_temp: Optional[float], soak_ph: Optional[float]) -> dict:
    soak_temp_color = soak_temp if soak_temp is not None else tank_temps["soak"]
    soak_ph_color = soak_ph if soak_ph is not None else tank_phs["soak"]
    return {
        "soak": color_for_ph_temp(soak_ph_color, soak_temp_color),
        "fresh": color_for_ph_temp(tank_phs["fresh"], tank_temps["fresh"]),
        "heat": color_for_ph_temp(tank_phs["heat"], tank_temps["heat"]),
    }


def build_status_snapshot() -> dict:
    soak_temp, soak_ph = get_soak_reading()
    tank_colors = build_tank_colors(soak_temp, soak_ph)
    base = gpio.snapshot()
    base["system"] = get_system_status()
    base["tank"] = {
        "soak": {
            "temp": soak_temp,
            "ph": soak_ph,
            "level": tank_levels["soak"],
            "color": list(tank_colors["soak"]),
        },
        "fresh": {
            "temp": tank_temps["fresh"],
            "ph": tank_phs["fresh"],
            "level": tank_levels["fresh"],
            "color": list(tank_colors["fresh"]),
        },
        "heat": {
            "temp": tank_temps["heat"],
            "ph": tank_phs["heat"],
            "level": tank_levels["heat"],
            "color": list(tank_colors["heat"]),
        },
    }
    return base


def persistence_loop() -> None:
    last_cleanup_ts = 0.0
    while True:
        now_ts = time.time()
        try:
            snapshot = build_status_snapshot()
            store.persist_snapshot(snapshot, now_ts)
            store.update_runtime_daily(snapshot, now_ts)
            if now_ts - last_cleanup_ts >= 3600:
                store.prune_old_data(now_ts)
                last_cleanup_ts = now_ts
        except Exception as exc:
            print(f"[persist] error: {exc}")
        time.sleep(PERSIST_SAMPLE_SEC)


app = FastAPI(title="Pump Relay Control")

cors_allow_origins = [
    origin.strip() for origin in os.getenv("CORS_ALLOW_ORIGINS", "*").split(",") if origin.strip()
]
if not cors_allow_origins:
    cors_allow_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_allow_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
)

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


@app.on_event("startup")
def on_startup() -> None:
    store.init_schema()
    restored = store.restore_lift_estimate(gpio.config.lift_max_mm)
    if restored is not None:
        gpio.set_lift_estimated_mm(restored)

    if PH_METER_ENABLED and serial:
        thread = threading.Thread(target=ph_reader_loop, daemon=True)
        thread.start()

    persist_thread = threading.Thread(target=persistence_loop, daemon=True)
    persist_thread.start()


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
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "pumps": gpio.relay_snapshot(),
            "tank_levels": tank_levels,
            "tank_temps": tank_temps,
            "tank_phs": tank_phs,
            "soak_temp": soak_temp,
            "soak_ph": soak_ph,
            "tank_colors": tank_colors,
            "auto_switches": gpio.auto_switches,
            "heater": {"configured": True, "on": gpio.heater.is_active},
        },
    )


@app.get("/api/status")
def api_status() -> dict:
    return build_status_snapshot()


@app.post("/api/relay")
def api_relay(cmd: RelayCommand) -> dict:
    prev = gpio.relay_snapshot()
    try:
        next_on = gpio.set_relay(cmd.index, cmd.on)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    prev_on = next((item["on"] for item in prev if item["index"] == cmd.index), False)
    store.record_control_event("api", f"relay:{cmd.index}", prev_on, next_on, True)
    return {"on": next_on}


@app.post("/api/auto")
def api_auto(cmd: AutoSwitchCommand) -> dict:
    if cmd.which not in gpio.auto_switches:
        raise HTTPException(status_code=400, detail="Invalid auto switch.")
    prev = gpio.auto_switches[cmd.which]
    try:
        auto_state = gpio.set_auto(cmd.which, cmd.on)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    store.record_control_event("api", f"auto:{cmd.which}", prev, auto_state[cmd.which], True)
    return {"auto": auto_state}


@app.post("/api/lift")
def api_lift(cmd: LiftCommand) -> dict:
    prev_state = gpio.lift_state
    try:
        state = gpio.set_lift(cmd.state)
    except ValueError as exc:
        store.record_control_event("api", "lift", prev_state, prev_state, False, str(exc))
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    mm, percent = gpio.get_lift_estimate()
    store.record_control_event("api", "lift", prev_state, state, True)
    return {
        "configured": True,
        "state": state,
        "estimated_mm": round(mm, 1),
        "estimated_percent": percent,
        "max_mm": int(gpio.config.lift_max_mm),
        "speed_mm_s": round(gpio.config.lift_speed_mm_s, 2),
    }


@app.post("/api/heater")
def api_heater(cmd: HeaterCommand) -> dict:
    prev = gpio.heater.is_active
    next_on = gpio.set_heater(cmd.on)
    store.record_control_event("api", "heater", prev, next_on, True)
    return {"configured": True, "on": next_on}


@app.get("/api/ping")
def api_ping() -> dict:
    return {"ok": True}


@app.get("/api/history")
def api_history(hours: float = 2.0, limit: int = 1500) -> dict:
    return store.get_history(hours=hours, limit=limit)


@app.get("/api/events")
def api_events(limit: int = 120) -> dict:
    return store.get_events(limit=limit)


@app.get("/api/runtime")
def api_runtime(days: int = 7) -> dict:
    return store.get_runtime(days=days)
