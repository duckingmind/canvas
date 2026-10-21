# Architecture and module boundaries

Canvas is a browser application hosted by the Proxy App platform. The frontend owns editor interaction and local recovery; the App Session SDK owns the host-facing session and Gateway transport.

## Runtime layers

```text
main.tsx
  ├── PlatformGate       session admission and account-scoped startup
  └── Workspace          document selection and editor lifecycle
        └── App.tsx      canvas scene, editor interactions, media panels
              ├── domain helpers   geometry, workflow, models, task state
              ├── persistence      local drafts, document KV, media caches
              └── platform client SDK session, Gateway, network boundary
```

The dependency direction should remain toward small, side-effect-light helpers. Pure functions should not import React or the platform SDK. UI components call domain and persistence services through explicit callbacks, and platform access stays behind the client/session boundary.

## Data and recovery

- Canvas documents are versioned JSON records. Local drafts and saved library documents have separate responsibilities.
- Binary media is stored through the image/audio/video caches; documents keep stable references rather than treating a temporary URL as durable identity.
- Cloud synchronization removes inline media after the local cache is written, then restores media through the referenced asset or cache record.
- Generation submissions retain their original input snapshot and idempotency identity. A lost response resumes by looking up that submission instead of issuing a new request.
- User data is scoped to the authenticated account. Switching accounts must clear or replace account-scoped state before opening another document.

## Network boundary

Business requests use the App Session Gateway. Direct media fetches go through `network-boundary.ts`, which rejects control-plane paths and local/private network hosts, and accepts signed external media only through the media path. Keep this policy in sync with the host Content Security Policy; the browser boundary is defense in depth, not an IP-reputation or DNS validation service.

## Current structure and gradual cleanup

The source tree currently keeps most modules at `src/` for compatibility with existing imports and fixture scripts. `src/shared/` groups the small, side-effect-free media status/diagnostic helpers and design tokens that Canvas needs when checked out alone. This is a safe first boundary. The large editor component is still the main future extraction target; move features incrementally behind tested editor contracts rather than doing a repository-wide path churn in one change.

A practical next sequence is to extract editor panels and scene rendering, then group persistence adapters and domain services, updating tests at each step. Every extraction should preserve document serialization, undo behavior, keyboard/focus ownership, and task recovery.
