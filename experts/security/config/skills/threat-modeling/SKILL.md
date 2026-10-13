---
name: threat-modeling
description: Model threats with STRIDE per trust boundary before scanning or reviewing.
---

# Threat modeling

## When to use

Use before reviewing a feature that moves trust (auth, input handling,
data access, new network paths).

## Procedure

1. Draw the trust boundaries: user, service, store, third party.
2. Walk STRIDE per boundary (spoofing, tampering, repudiation,
   information disclosure, denial of service, elevation).
3. Rank the threats and aim the scanning and review at the top of the
   list.

## Good result

A short threat list with boundaries named; review findings trace back to
a threat, not to a scanner's mood.
