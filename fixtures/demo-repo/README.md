# Demo repository

A tiny HTTP service for the Stage 1b demo workspace. Install once with
`bun install`; every check below then runs offline.

```sh
bun install
bun test
bunx tsc --noEmit
bunx oxlint
bunx prettier --check .
```
