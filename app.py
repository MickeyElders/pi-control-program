import os
from typing import Optional

from fastapi import FastAPI, Request
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


PIN = int(os.getenv("RELAY_GPIO", "17"))
ACTIVE_LOW = os.getenv("RELAY_ACTIVE_LOW", "1").lower() in {"1", "true", "yes", "on"}

relay = DigitalOutputDevice(PIN, active_high=not ACTIVE_LOW, initial_value=False)
relay.off()

app = FastAPI(title="Pump Relay Control")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


class RelayCommand(BaseModel):
    on: bool


@app.get("/", response_class=HTMLResponse)
def index(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "is_on": relay.is_active,
            "pin": PIN,
            "active_low": ACTIVE_LOW,
        },
    )


@app.get("/api/status")
def api_status() -> dict:
    return {"on": relay.is_active}


@app.post("/api/relay")
def api_relay(cmd: RelayCommand) -> dict:
    if cmd.on:
        relay.on()
    else:
        relay.off()
    return {"on": relay.is_active}


@app.get("/api/ping")
def api_ping() -> dict:
    return {"ok": True}

