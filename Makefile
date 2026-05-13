# Thin wrapper around npm scripts and docker compose.
# All real logic lives in package.json / compose.yml — keep this file shallow.

SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: help install dev build preview check check-css assets \
        sync-citations sync-bibtex clean distclean \
        docker-dev docker-prod docker-down

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "; printf "Usage: make \033[36m<target>\033[0m\n\nTargets:\n"} \
	     /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install npm dependencies
	npm ci

dev: ## Run Astro dev server on :4321 (predev rebuilds assets)
	npm run dev

build: ## Production build: astro + pagefind + CV PDF (prebuild syncs CrossRef data)
	npm run build

preview: ## Serve the built dist/ locally
	npm run preview

check: ## Run astro check (TypeScript on .astro/.ts/.mts)
	npm run check

check-css: ## Run the project's CSS sanity check
	npm run check:css

assets: ## Rebuild public/icon.png, fonts, and QR only
	npm run build-assets

sync-citations: ## Refresh src/data/citations.json from CrossRef
	npm run sync-citations

sync-bibtex: ## Refresh src/data/bibtex.json from CrossRef
	npm run sync-bibtex

clean: ## Remove build output (dist/, .astro/ cache)
	rm -rf dist .astro

distclean: clean ## Also remove node_modules and Playwright/OG caches
	rm -rf node_modules node_modules/.cache

docker-dev: ## docker compose up dev (HMR on :4321)
	docker compose up dev

docker-prod: ## docker compose up prod (nginx on :8080)
	docker compose up prod

docker-down: ## Stop and remove docker compose containers
	docker compose down
