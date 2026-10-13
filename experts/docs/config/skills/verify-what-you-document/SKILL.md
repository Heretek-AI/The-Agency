---
name: verify-what-you-document
description: Run every documented command in a clean checkout and quote the output you actually saw.
---

# Verify what you document

## When to use

Use for every page with commands, always. Undocumented drift starts with
an unrun example.

## Procedure

1. Run each command in a clean checkout, in the order the page shows.
2. Paste the observed output; adjust the prose to match reality, not the
   reverse.
3. Run the link checker over the finished page.

## Commands

- `markdownlint-cli2 'docs/**/*.md'`
- `lychee --no-progress docs/<page>.md`

## Good result

A new user following the page succeeds without surprises; lint and links
clean.
