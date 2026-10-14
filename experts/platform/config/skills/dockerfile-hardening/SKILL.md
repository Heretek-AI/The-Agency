---
name: dockerfile-hardening
description: Write hardened Dockerfiles: pinned base by digest, non-root user, no extra capabilities, hadolint-clean.
---

# Dockerfile hardening

## When to use

Use for every Dockerfile you write or review. An unpinned base is a
supply-chain hole.

## Procedure

1. Pin the base by digest, pin every installed version, and record pins
   where the repo keeps them.
2. Run as a non-root user, drop capabilities, and keep the build context
   minimal.
3. Run `hadolint` and fix every finding before committing.

## Commands

- `hadolint Dockerfile`
- `docker build --check -f Dockerfile .`

## Good result

hadolint clean, digest-pinned, non-root; the image builds from a clean
context.
