.PHONY: check format-check lint typecheck ts-coverage render-check test accept
.PHONY: init render workspace build up down ps logs smoke e2e gc

BUN ?= bun
STAGE ?= 0

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
	@echo "render-check: nothing to render yet (renderer arrives in stage 1b)"

test:
	@bash -c 'files="$$(git ls-files "*.test.ts" ":!:*/test/live/*"; git ls-files --others --exclude-standard "*.test.ts" | grep -v "/test/live/" | sort -u)"; if [ -z "$$files" ]; then echo "test: no unit tests found" >&2; exit 1; fi; $(BUN) test $$files'

accept:
	bash scripts/accept.sh $(STAGE)

init:
	@echo "not built until stage 1b: init" >&2; exit 1

render:
	@echo "not built until stage 1b: render" >&2; exit 1

workspace:
	@echo "not built until stage 1b: workspace" >&2; exit 1

build:
	@echo "not built until stage 1a: build" >&2; exit 1

up:
	@echo "not built until stage 1b: up" >&2; exit 1

down:
	@echo "not built until stage 1b: down" >&2; exit 1

ps:
	@echo "not built until stage 1d: ps" >&2; exit 1

logs:
	@echo "not built until stage 1d: logs" >&2; exit 1

smoke:
	@echo "not built until stage 1d: smoke" >&2; exit 1

e2e:
	@echo "not built until stage 4c: e2e" >&2; exit 1

gc:
	@echo "not built until stage 3b: gc" >&2; exit 1
