# Interaction and regression guide

This document describes the locally reproducible interaction areas. It does not claim that a passing fixture proves production model behavior, billing, or provider reliability.

## Main flows

- **Canvas library:** create, switch, rename, duplicate, import/export, recover and soft-delete documents without losing the active editor state.
- **Creator:** edit a prompt, attach or remove a reference, validate settings, submit once, and keep editing while a task runs.
- **Task recovery:** retain submission identity across refresh and retry reads without creating a duplicate task.
- **Preview:** browse results, return to source nodes, handle loading failures and keep focus/selection predictable.
- **Small screens:** keep the active input and primary action visible without horizontal overflow.

## Local tests

Run `npm test` for deterministic unit tests. Browser checks are separate scripts in `tests/`; they use loopback fixtures and isolated browser contexts. `npm run test:e2e:creator` is a representative end-to-end check. Other scripts can be run directly with Node after installing Playwright and a browser.

Before submitting changes, run `npm run typecheck`, `npm run build`, and `npm test`. Changes to stored documents should add migration/recovery tests. Changes to task status should test both a network error and a later successful read. Changes to media fetch behavior should include an assertion that forbidden URLs are rejected before transport.
