APP_NAME := pump-control
SERVICE_NAME := $(APP_NAME).service
SERVICE_FILE := pump-control.service
SYSTEMD_DIR := /etc/systemd/system

PYTHON ?= python3
WORKDIR ?= $(CURDIR)
VENV ?= $(WORKDIR)/.venv
PIP ?= $(VENV)/bin/pip
UVICORN ?= $(VENV)/bin/uvicorn
PORT ?= 8000
PIN_FACTORY ?= lgpio
GPIO_BACKEND ?= gpiozero
PIN_MODE ?=

# Force safe defaults even when empty values are injected from environment.
PIN_FACTORY := $(if $(strip $(PIN_FACTORY)),$(PIN_FACTORY),lgpio)
GPIO_BACKEND := $(if $(strip $(GPIO_BACKEND)),$(GPIO_BACKEND),gpiozero)

SERVICE_USER ?= $(USER)
RELAY_GPIO ?=
DEFAULT_RELAY_PINS ?= 27,22,23
DEFAULT_VALVE_PINS ?=
DEFAULT_HEATER_GPIO ?=
DEFAULT_LIFT_PINS ?=
DEFAULT_PIN_MODE ?=

ifneq (,$(filter jetson rpigpio,$(GPIO_BACKEND)))
DEFAULT_RELAY_PINS ?= 7,11,13
DEFAULT_VALVE_PINS ?= 15,16
DEFAULT_HEATER_GPIO ?= 18
DEFAULT_LIFT_PINS ?= 19,21
DEFAULT_PIN_MODE ?= BOARD
endif

RELAY_PINS ?= $(if $(strip $(RELAY_GPIO)),$(RELAY_GPIO),$(DEFAULT_RELAY_PINS))
RELAY_ACTIVE_LOW ?= 1
TANK_LEVELS ?= 72,58,46
TANK_TEMPS ?= 32.5,22.0,45.0
TANK_PHS ?= 6.8,7.2,6.5
HEATER_GPIO ?= $(DEFAULT_HEATER_GPIO)
HEATER_ACTIVE_LOW ?= 1
VALVE_PINS ?= $(DEFAULT_VALVE_PINS)
VALVE_ACTIVE_LOW ?= 1
LIFT_PINS ?= $(DEFAULT_LIFT_PINS)
LIFT_ACTIVE_LOW ?= 1
PIN_MODE ?= $(DEFAULT_PIN_MODE)

.PHONY: help deps venv install-service install reinstall uninstall start stop restart status logs

help:
	@echo "make deps           # install system deps (python3-venv)"
	@echo "make install        # create venv, install pip deps, install+start service"
	@echo "make reinstall      # uninstall then install"
	@echo "make uninstall      # stop service and remove venv/service"
	@echo "make start|stop|restart|status|logs"
	@echo ""
	@echo "Overrides:"
	@echo "  WORKDIR=/path/to/repo SERVICE_USER=pi RELAY_PINS=27,22,23 RELAY_ACTIVE_LOW=1 TANK_LEVELS=72,58,46 TANK_TEMPS=32.5,22.0,45.0 TANK_PHS=6.8,7.2,6.5 HEATER_GPIO=5 HEATER_ACTIVE_LOW=1 VALVE_PINS=23,24 VALVE_ACTIVE_LOW=1 LIFT_PINS=5,6 LIFT_ACTIVE_LOW=1 GPIO_BACKEND=jetson PIN_MODE=BOARD PIN_FACTORY=lgpio PORT=8000"

deps:
	@command -v apt-get >/dev/null 2>&1 || { \
		echo "apt-get not found. Please install python3 and python3-venv manually."; \
		exit 1; \
	}; \
	missing=""; \
	for pkg in python3 python3-venv; do \
		dpkg -s $$pkg >/dev/null 2>&1 || missing="$$missing $$pkg"; \
	done; \
	gpio_pkg=""; \
	if [ "$(GPIO_BACKEND)" = "jetson" ] || [ -f /etc/nv_tegra_release ]; then \
		if dpkg -s python3-jetson-gpio >/dev/null 2>&1; then \
			gpio_pkg=""; \
		else \
			gpio_pkg="python3-jetson-gpio"; \
		fi; \
	else \
		if dpkg -s python3-lgpio >/dev/null 2>&1; then \
			gpio_pkg=""; \
		elif dpkg -s python3-rpi.gpio >/dev/null 2>&1; then \
			gpio_pkg=""; \
		else \
			if [ -f /etc/os-release ]; then \
				codename=$$(. /etc/os-release && echo $$VERSION_CODENAME); \
			else \
				codename=""; \
			fi; \
			case "$$codename" in \
				bookworm|trixie|sid) gpio_pkg="python3-lgpio" ;; \
				*) gpio_pkg="python3-rpi.gpio" ;; \
			esac; \
		fi; \
	fi; \
	if [ -n "$$gpio_pkg" ]; then \
		missing="$$missing $$gpio_pkg"; \
	fi; \
	if [ -n "$$missing" ]; then \
		echo "Installing missing packages:$$missing"; \
		sudo apt-get update; \
		sudo apt-get install -y $$missing; \
	else \
		echo "System dependencies already installed."; \
	fi

venv:
	$(PYTHON) -m venv --system-site-packages $(VENV)
	$(PIP) install -r requirements.txt

install-service:
	@tmp=$$(mktemp); \
	sed -e "s|^User=.*|User=$(SERVICE_USER)|" \
	    -e "s|^WorkingDirectory=.*|WorkingDirectory=$(WORKDIR)|" \
	    -e "s|^ExecStart=.*|ExecStart=$(UVICORN) app:app --host 0.0.0.0 --port $(PORT)|" \
	    -e "s|^Environment=RELAY_PINS=.*|Environment=RELAY_PINS=$(RELAY_PINS)|" \
	    -e "s|^Environment=RELAY_ACTIVE_LOW=.*|Environment=RELAY_ACTIVE_LOW=$(RELAY_ACTIVE_LOW)|" \
	    -e "s|^Environment=TANK_LEVELS=.*|Environment=TANK_LEVELS=$(TANK_LEVELS)|" \
	    -e "s|^Environment=TANK_TEMPS=.*|Environment=TANK_TEMPS=$(TANK_TEMPS)|" \
	    -e "s|^Environment=TANK_PHS=.*|Environment=TANK_PHS=$(TANK_PHS)|" \
	    -e "s|^Environment=HEATER_GPIO=.*|Environment=HEATER_GPIO=$(HEATER_GPIO)|" \
	    -e "s|^Environment=HEATER_ACTIVE_LOW=.*|Environment=HEATER_ACTIVE_LOW=$(HEATER_ACTIVE_LOW)|" \
	    -e "s|^Environment=VALVE_PINS=.*|Environment=VALVE_PINS=$(VALVE_PINS)|" \
	    -e "s|^Environment=VALVE_ACTIVE_LOW=.*|Environment=VALVE_ACTIVE_LOW=$(VALVE_ACTIVE_LOW)|" \
	    -e "s|^Environment=LIFT_PINS=.*|Environment=LIFT_PINS=$(LIFT_PINS)|" \
	    -e "s|^Environment=LIFT_ACTIVE_LOW=.*|Environment=LIFT_ACTIVE_LOW=$(LIFT_ACTIVE_LOW)|" \
	    -e "s|^Environment=GPIO_BACKEND=.*|Environment=GPIO_BACKEND=$(GPIO_BACKEND)|" \
	    -e "s|^Environment=PIN_MODE=.*|Environment=PIN_MODE=$(PIN_MODE)|" \
	    -e "s|^Environment=GPIOZERO_PIN_FACTORY=.*|Environment=GPIOZERO_PIN_FACTORY=$(PIN_FACTORY)|" \
	    $(SERVICE_FILE) > $$tmp; \
	sudo install -m 644 $$tmp $(SYSTEMD_DIR)/$(SERVICE_NAME); \
	rm -f $$tmp; \
	sudo systemctl daemon-reload

install: deps venv install-service
	sudo systemctl enable --now $(SERVICE_NAME)

reinstall: uninstall install

uninstall:
	- sudo systemctl disable --now $(SERVICE_NAME)
	- sudo rm -f $(SYSTEMD_DIR)/$(SERVICE_NAME)
	- sudo systemctl daemon-reload
	rm -rf $(VENV)

start:
	sudo systemctl start $(SERVICE_NAME)

stop:
	sudo systemctl stop $(SERVICE_NAME)

restart:
	sudo systemctl restart $(SERVICE_NAME)

status:
	systemctl status $(SERVICE_NAME)

logs:
	journalctl -u $(SERVICE_NAME) -e
