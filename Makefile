.PHONY: check format-check lint typecheck ts-coverage render-check test accept
.PHONY: init render workspace build up down ps logs smoke e2e gc

BUN ?= bun
STAGE ?= 0

BASE_TAG ?= $(shell grep '^OPENCODE_VERSION=' versions.env | cut -d= -f2)
BASE_IMAGE ?= agency-base:$(BASE_TAG)

check: format-check lint typecheck ts-coverage render-check test

format-check:
	$(BUN)x prettier --check .

lint:
	$(BUN)x oxlint
	@echo "lint: process.env is read only in config.ts"
	@! grep -rn "process\.env" dispatcher/src verifier/src --include='*.ts' | grep -v "src/config.ts"
	@echo "lint: task/mission status lists live only in model.ts"
	@! grep -rn "waiting-human" dispatcher/src verifier/src scripts --include='*.ts' | grep -v "dispatcher/src/model.ts"
	@echo "lint: RESULT/VERDICT schemas are defined only in protocol.ts"
	@! grep -rnE "(ResultBlockSchema|VerdictBlockSchema)[[:space:]]*=" dispatcher/src verifier/src scripts --include='*.ts' | grep -v "dispatcher/src/protocol.ts"
	@echo "lint: no placeholder successes in first-party source"
	@! grep -rniE "todo|fixme|placeholder|invented result|hard-coded (outcome|success|pass)" dispatcher/src verifier/src --include='*.ts'

typecheck:
	$(BUN)x tsc --noEmit

ts-coverage:
	$(BUN) scripts/check-ts-coverage.ts

render-check:
	$(BUN) scripts/render.ts --check

test:
	@bash -c 'files="$$(git ls-files "*.test.ts" ":!:*/test/live/*"; git ls-files --others --exclude-standard "*.test.ts" | grep -v "/test/live/" | sort -u)"; if [ -z "$$files" ]; then echo "test: no unit tests found" >&2; exit 1; fi; $(BUN) test $$files'

accept:
	bash scripts/accept.sh $(STAGE)

build-base:
	docker build -f images/base/Dockerfile \
		--build-arg AGENT_UID=$${AGENT_UID:-$$(id -u)} \
		--build-arg AGENT_GID=$${AGENT_GID:-$$(id -g)} \
		-t $(BASE_IMAGE) images/base

init:
	bash scripts/init-env.sh

render:
	$(BUN) scripts/render.ts

workspace:
	bash scripts/workspace-init.sh $(ARGS)

build:
	docker compose build

up:
	docker compose up -d

down:
	docker compose down

ps:
	docker compose ps

logs:
	docker compose logs $(ARGS)

smoke:
	bash scripts/smoke.sh

e2e:
	@echo "not built until stage 4c: e2e" >&2; exit 1

gc:
	@echo "not built until stage 3b: gc" >&2; exit 1
