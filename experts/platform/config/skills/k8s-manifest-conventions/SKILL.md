---
name: k8s-manifest-conventions
description: Write Kubernetes manifests with explicit namespaces, limits, probes, and kubeconform-clean schemas.
---

# Kubernetes manifest conventions

## When to use

Use for every manifest you write or review.

## Procedure

1. Set the namespace, resource requests and limits, and readiness and
   liveness probes on every workload.
2. Run as non-root with a read-only root filesystem where the app
   allows it.
3. Validate with `kubeconform` against the target cluster version.

## Commands

- `kubeconform -kubernetes-version 1.37.1 manifests/`
- `kubectl apply --dry-run=client -f manifests/`

## Good result

kubeconform clean, every workload probed and limited, no cluster-wide
permissions without a written reason.
