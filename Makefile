SHELL := bash
.ONESHELL:
.DEFAULT_GOAL := help

.PHONY: help install typecheck test test-contracts test-bertrand lint build gate

help: ## Show available commands
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "%-18s %s\n", $$1, $$2}'

install: ## Install npm dependencies
	npm install

typecheck: ## Run TypeScript typecheck
	npm run typecheck

test: ## Run contract tests
	npm test

test-contracts: ## Run all contract tests
	npm run test:contracts

test-bertrand: ## Run Bertrand-Meyer contract tests
	npm run test:bertrand

lint: ## Lint source and tests
	npm run lint

build: ## Build/typecheck project
	npm run build

gate: ## Run full verification gate
	npm run gate

style-lines: ## Run local StylePath CLI; pass ARGS="--fen ..." or ARGS="--raw-file file"
	npm run style:lines -- $${ARGS}

install-style-engines: ## Install local Patricia, Jackal, and Seer engines under .local
	npm run install:style-engines

verify-style-engines: ## Verify local Patricia, Jackal, Seer, and Maia UCI readiness
	npm run verify:style-engines:local
