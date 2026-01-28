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

SERVICE_USER ?= $(USER)
RELAY_GPIO ?= 17
RELAY_ACTIVE_LOW ?= 1

.PHONY: help deps venv install-service install reinstall uninstall start stop restart status logs

help:
	@echo "make deps           # install system deps (python3-venv)"
	@echo "make install        # create venv, install pip deps, install+start service"
	@echo "make reinstall      # uninstall then install"
	@echo "make uninstall      # stop service and remove venv/service"
	@echo "make start|stop|restart|status|logs"
	@echo ""
	@echo "Overrides:"
	@echo "  WORKDIR=/path/to/repo SERVICE_USER=pi RELAY_GPIO=17 RELAY_ACTIVE_LOW=1 PORT=8000"

deps:
	sudo apt-get update
	sudo apt-get install -y python3-venv

venv:
	$(PYTHON) -m venv $(VENV)
	$(PIP) install -r requirements.txt

install-service:
	@tmp=$$(mktemp); \
	sed -e "s|^User=.*|User=$(SERVICE_USER)|" \
	    -e "s|^WorkingDirectory=.*|WorkingDirectory=$(WORKDIR)|" \
	    -e "s|^ExecStart=.*|ExecStart=$(UVICORN) app:app --host 0.0.0.0 --port $(PORT)|" \
	    -e "s|^Environment=RELAY_GPIO=.*|Environment=RELAY_GPIO=$(RELAY_GPIO)|" \
	    -e "s|^Environment=RELAY_ACTIVE_LOW=.*|Environment=RELAY_ACTIVE_LOW=$(RELAY_ACTIVE_LOW)|" \
	    $(SERVICE_FILE) > $$tmp; \
	sudo install -m 644 $$tmp $(SYSTEMD_DIR)/$(SERVICE_NAME); \
	rm -f $$tmp; \
	sudo systemctl daemon-reload

install: venv install-service
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
