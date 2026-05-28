SHELL := /bin/bash

PYTHON ?= python3
VENV := .venv
PIP := $(VENV)/bin/pip
PYTEST := $(VENV)/bin/pytest
BACKEND_HOST ?= 127.0.0.1
BACKEND_PORT ?= 8787
FRONTEND_PORT ?= 3107
FRONTEND_ORIGIN := http://$(BACKEND_HOST):$(FRONTEND_PORT)
API_BASE := http://$(BACKEND_HOST):$(BACKEND_PORT)

.PHONY: install backend-deps frontend-deps dev backend-dev frontend-dev test clean

install: backend-deps frontend-deps

$(VENV)/bin/python:
	$(PYTHON) -m venv $(VENV)

backend-deps: $(VENV)/bin/python
	$(PIP) install -r requirements.txt

frontend-deps:
	cd frontend && npm install

backend-dev: backend-deps
	APP_HOST=$(BACKEND_HOST) APP_PORT=$(BACKEND_PORT) CORS_ALLOWED_ORIGINS=$(FRONTEND_ORIGIN) \
	$(VENV)/bin/python -m uvicorn backend.app.main:app --reload --host $(BACKEND_HOST) --port $(BACKEND_PORT)

frontend-dev:
	cd frontend && NEXT_PUBLIC_API_BASE_URL=$(API_BASE) npm run dev -- --hostname $(BACKEND_HOST) --port $(FRONTEND_PORT)

dev: backend-deps
	npx --yes concurrently --kill-others --names "BACKEND,FRONTEND" --prefix-colors "blue,magenta" \
		"APP_HOST=$(BACKEND_HOST) APP_PORT=$(BACKEND_PORT) CORS_ALLOWED_ORIGINS=$(FRONTEND_ORIGIN) $(VENV)/bin/python -m uvicorn backend.app.main:app --reload --host $(BACKEND_HOST) --port $(BACKEND_PORT)" \
		"cd frontend && NEXT_PUBLIC_API_BASE_URL=$(API_BASE) npm run dev -- --hostname $(BACKEND_HOST) --port $(FRONTEND_PORT)"

test: backend-deps
	$(PYTEST) -q
	cd frontend && npm run lint
	cd frontend && NEXT_PUBLIC_API_BASE_URL=$(API_BASE) npm run build

clean:
	rm -rf $(VENV)
	rm -rf frontend/.next
	find backend -type d -name "__pycache__" -exec rm -rf {} +
	find . -type d -name ".pytest_cache" -exec rm -rf {} +

