---
name: dependency-risk-review
description: Review dependency and container risk with scanners, and judge upgrade urgency by reachability.
---

# Dependency risk review

## When to use

Use for manifest changes, new images, and periodic reviews. Judge by
whether the vulnerable code is reachable, not by CVE count.

## Procedure

1. Scan manifests and lockfiles (`osv-scanner`), images (`trivy`, `grype`),
   and SBOMs (`syft`).
2. For each high or critical finding, check whether the package's
   vulnerable path is reachable from the application.
3. Recommend upgrade, replacement, or accepted-risk with an expiry, per
   finding.

## Commands

- `osv-scanner --lockfile=pnpm-lock.yaml`
- `trivy fs --severity HIGH,CRITICAL .`
- `syft . -o cyclonedx-json`

## Good result

Ranked findings with reachability notes; accepted risks carry an owner
and an expiry.
