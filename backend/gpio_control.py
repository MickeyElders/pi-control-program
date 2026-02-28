import os
import threading
import time
from dataclasses import dataclass
from typing import Dict, List, Optional, Protocol

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


class OutputDevice(Protocol):
    pin: int

    def on(self) -> None: ...

    def off(self) -> None: ...

    @property
    def is_active(self) -> bool: ...

    @property
    def value(self) -> int: ...

    def close(self) -> None: ...


def env_flag(name: str, default: str) -> bool:
    return os.getenv(name, default).lower() in {"1", "true", "yes", "on"}


class JetsonOutputDevice:
    def __init__(self, pin: int, pin_mode: str, active_low: bool = False, initial_value: bool = False) -> None:
        self.pin = pin
        self.active_low = active_low
        self._is_active = bool(initial_value)
        if pin_mode == "BCM":
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
    def __init__(self, pin: int, pin_mode: str, active_low: bool = False, initial_value: bool = False) -> None:
        self.pin = pin
        self.active_low = active_low
        self._is_active = bool(initial_value)
        if pin_mode == "BCM":
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
        self.device = GpiozeroDigitalOutputDevice(pin, active_high=not active_low, initial_value=initial_value)
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


@dataclass
class GPIOConfig:
    backend: str = os.getenv("GPIO_BACKEND", "auto").lower()
    pin_mode: str = os.getenv("PIN_MODE", "BOARD").upper()

    pin_pump1: int = 4
    pin_pump2: int = 14
    pin_pump3: int = 15
    pin_valve_fresh: int = 17
    pin_valve_heat: int = 18
    pin_heater: int = 27
    pin_lift_up: int = 22
    pin_lift_down: int = 24

    relay_active_low: bool = env_flag("RELAY_ACTIVE_LOW", "0")
    valve_active_low: bool = env_flag("VALVE_ACTIVE_LOW", os.getenv("RELAY_ACTIVE_LOW", "0"))
    heater_active_low: bool = env_flag("HEATER_ACTIVE_LOW", os.getenv("RELAY_ACTIVE_LOW", "0"))
    lift_active_low: bool = env_flag("LIFT_ACTIVE_LOW", os.getenv("RELAY_ACTIVE_LOW", "0"))

    lift_speed_mm_s: float = max(0.1, float(os.getenv("LIFT_SPEED_MM_S", "10")))
    lift_max_mm: float = max(1.0, float(os.getenv("LIFT_MAX_MM", "1000")))


class GPIOController:
    def __init__(self, config: Optional[GPIOConfig] = None) -> None:
        self.config = config or GPIOConfig()
        self.backend = self._detect_backend(self.config.backend)

        self.pump1 = self._create_output_device(self.config.pin_pump1, self.config.relay_active_low)
        self.pump2 = self._create_output_device(self.config.pin_pump2, self.config.relay_active_low)
        self.pump3 = self._create_output_device(self.config.pin_pump3, self.config.relay_active_low)
        for pump in (self.pump1, self.pump2, self.pump3):
            pump.off()

        self.valve_fresh = self._create_output_device(self.config.pin_valve_fresh, self.config.valve_active_low)
        self.valve_heat = self._create_output_device(self.config.pin_valve_heat, self.config.valve_active_low)
        self.valve_fresh.off()
        self.valve_heat.off()

        self.lift_up = self._create_output_device(self.config.pin_lift_up, self.config.lift_active_low)
        self.lift_down = self._create_output_device(self.config.pin_lift_down, self.config.lift_active_low)
        self.lift_up.off()
        self.lift_down.off()

        self.heater = self._create_output_device(self.config.pin_heater, self.config.heater_active_low)
        self.heater.off()

        self.auto_switches = {"fresh": False, "heat": False}
        self.lift_state = "stop"
        self.lift_lock = threading.Lock()
        self.lift_estimated_mm = 0.0
        self.lift_last_update_ts = time.time()

    def _detect_backend(self, raw_backend: str) -> str:
        backend = raw_backend.lower()
        if backend in {"jetson", "jetson-gpio"}:
            if not JetsonGPIO:
                raise RuntimeError("GPIO_BACKEND=jetson requires Jetson.GPIO to be installed.")
            return "jetson"
        if backend in {"rpigpio", "rpi", "raspi", "raspberrypi"}:
            if not RPiGPIO:
                raise RuntimeError("GPIO_BACKEND=rpigpio requires RPi.GPIO to be installed.")
            return "rpigpio"
        if backend in {"gpiozero"}:
            if not GpiozeroDigitalOutputDevice:
                raise RuntimeError("GPIO_BACKEND=gpiozero requires gpiozero to be installed.")
            return "gpiozero"

        if JetsonGPIO:
            return "jetson"
        if RPiGPIO:
            return "rpigpio"
        if GpiozeroDigitalOutputDevice:
            return "gpiozero"
        return "stub"

    def _create_output_device(self, pin: int, active_low: bool) -> OutputDevice:
        if self.backend == "jetson":
            return JetsonOutputDevice(pin, pin_mode=self.config.pin_mode, active_low=active_low, initial_value=False)
        if self.backend == "rpigpio":
            return RpiOutputDevice(pin, pin_mode=self.config.pin_mode, active_low=active_low, initial_value=False)
        if self.backend == "gpiozero":
            return GpiozeroOutputDevice(pin, active_low=active_low, initial_value=False)
        return StubOutputDevice(pin, active_low=active_low, initial_value=False)

    def _update_lift_estimate_locked(self, now_ts: Optional[float] = None) -> None:
        now = now_ts if now_ts is not None else time.time()
        elapsed = max(0.0, now - self.lift_last_update_ts)
        if elapsed <= 0:
            return
        if self.lift_state == "up":
            self.lift_estimated_mm = min(self.config.lift_max_mm, self.lift_estimated_mm + self.config.lift_speed_mm_s * elapsed)
        elif self.lift_state == "down":
            self.lift_estimated_mm = max(0.0, self.lift_estimated_mm - self.config.lift_speed_mm_s * elapsed)
        self.lift_last_update_ts = now

    def set_lift_estimated_mm(self, value_mm: float) -> None:
        with self.lift_lock:
            self.lift_estimated_mm = max(0.0, min(self.config.lift_max_mm, float(value_mm)))
            self.lift_last_update_ts = time.time()

    def get_lift_estimate(self) -> tuple[float, int]:
        with self.lift_lock:
            self._update_lift_estimate_locked()
            mm = float(self.lift_estimated_mm)
        percent = int(round((mm / self.config.lift_max_mm) * 100))
        return mm, max(0, min(100, percent))

    def relay_snapshot(self) -> List[Dict[str, object]]:
        return [
            {"index": 0, "pin": self.config.pin_pump1, "on": self.pump1.is_active},
            {"index": 1, "pin": self.config.pin_pump2, "on": self.pump2.is_active},
            {"index": 2, "pin": self.config.pin_pump3, "on": self.pump3.is_active},
        ]

    def set_relay(self, index: int, on: bool) -> bool:
        if index == 0:
            target = self.pump1
        elif index == 1:
            target = self.pump2
        elif index == 2:
            target = self.pump3
        else:
            raise ValueError("Invalid relay index.")
        if on:
            target.on()
        else:
            target.off()
        return target.is_active

    def set_auto(self, which: str, on: bool) -> Dict[str, object]:
        if which not in self.auto_switches:
            raise ValueError("Invalid auto switch.")
        self.auto_switches[which] = bool(on)
        if which == "fresh":
            if on:
                self.valve_fresh.on()
            else:
                self.valve_fresh.off()
        else:
            if on:
                self.valve_heat.on()
            else:
                self.valve_heat.off()
        return {
            "fresh": self.auto_switches["fresh"],
            "heat": self.auto_switches["heat"],
            "configured": True,
        }

    def set_lift(self, state: str) -> str:
        if state not in {"up", "down"}:
            raise ValueError("Invalid lift state.")
        with self.lift_lock:
            self._update_lift_estimate_locked()
            if state == "up":
                if self.lift_state == "down":
                    raise ValueError("Lift is moving down.")
                if self.lift_state == "up":
                    self.lift_up.off()
                    self.lift_down.off()
                    self.lift_state = "stop"
                    return self.lift_state
                self.lift_down.off()
                self.lift_up.on()
                self.lift_state = "up"
                return self.lift_state

            if self.lift_state == "up":
                raise ValueError("Lift is moving up.")
            if self.lift_state == "down":
                self.lift_up.off()
                self.lift_down.off()
                self.lift_state = "stop"
                return self.lift_state
            self.lift_up.off()
            self.lift_down.on()
            self.lift_state = "down"
            return self.lift_state

    def set_heater(self, on: bool) -> bool:
        if on:
            self.heater.on()
        else:
            self.heater.off()
        return self.heater.is_active

    def snapshot(self) -> Dict[str, object]:
        mm, percent = self.get_lift_estimate()
        return {
            "relays": self.relay_snapshot(),
            "auto": {
                "fresh": self.auto_switches["fresh"],
                "heat": self.auto_switches["heat"],
                "configured": True,
            },
            "lift": {
                "configured": True,
                "state": self.lift_state,
                "estimated_mm": round(mm, 1),
                "estimated_percent": percent,
                "max_mm": int(self.config.lift_max_mm),
                "speed_mm_s": round(self.config.lift_speed_mm_s, 2),
            },
            "heater": {
                "configured": True,
                "on": self.heater.is_active,
            },
        }
