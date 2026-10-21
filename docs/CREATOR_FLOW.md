# Creator flow

A typical creation flow keeps the prompt, references, model settings and task status together around the selected node. This document describes Canvas behavior and local regression goals.

## Flow

1. Select a prompt node and edit its text or references.
2. Choose a model and parameters that the current platform capability catalog reports as available.
3. Save the immutable submission snapshot and idempotency key before sending the request.
4. Keep the editor usable while the task runs; do not overwrite prior results or reopen a panel the user closed.
5. Resume by reading the original task. If the response to submission was lost, look up the same idempotency identity before considering another submission.
6. Show the result or a clear recovery action; never turn an unconfirmed provider outcome into a safe-to-retry failure.

## Interaction details

Reference thumbnails can be previewed or removed without clearing the prompt. Reference uploads and selections stay attached to the active creator. “Input updated” compares the current effective prompt, enabled references and model against the submitted snapshot; moving or renaming a node does not count as an input change.

Task details are separate from input editing. This lets the user prepare a future prompt while an existing task remains tied to its saved submission. A completed task does not steal focus, and each result remains independently browsable.

The browser regression in `tests/creator-e2e.mjs` exercises this flow with local fixtures. It does not verify live provider quality, account permissions, quota, billing or production availability.
