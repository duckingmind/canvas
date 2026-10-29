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

## Groups and layout

Grouping is a document-level relationship, not a second workflow node. Each
member stores a `groupId`; the visible frame is derived from current member
bounds and is rebuilt after membership, geometry, deletion, generation-result,
or import changes. The frame is therefore presentation state and never an
independent source of truth.

Both the editor's layout commands and the Agent `arrange_nodes` capability use
the same geometry service. A group is collapsed into one layout unit, edges
inside that unit are ignored for outer placement, and every member receives the
same translation so its internal spacing and hidden task metadata remain
consistent. A partial modifier selection is intentionally treated as an
explicit member-level operation; a complete group selection includes its
logical members before layout. After every layout write, group frames are
rebuilt and persisted with the document. This keeps manual grouping, dragging,
auto-layout, undo, and Agent writes on one invariant.

## Data and recovery

- Canvas documents are versioned JSON records. Local drafts and saved library documents have separate responsibilities.
- Binary media is stored through the image/audio/video caches; documents keep stable references rather than treating a temporary URL as durable identity.
- Cloud synchronization first commits the local snapshot and an outbox revision, then projects the document into a cloud-safe DTO. It never converts browser-local media, uploads bytes, or discovers assets. The cloud record contains stable `assetId`/task identities and durable metadata; it never contains media bytes, inline image data, signed URLs or blob URLs. A scoped `localVideo`/`localAudio` key may remain beside a stable identity as an optional same-browser playback hint and is ignored during cross-device recovery.
- Each cloud save atomically updates one document manifest and one compact `canvas:sync:v1:<id>` marker with KV batch CAS. The marker is overwritten in place; Canvas does not append an operation log or create a key for each edit. `BroadcastChannel` wakes sibling windows immediately, while a visible editor checks only the marker every five seconds for changes from another device. A clean editor adopts the remote snapshot; a dirty or actively saving editor keeps its draft and exposes the remote version through the existing conflict flow.
- The document storage adapter keeps documents up to 240 KiB in the legacy single-value format. Larger cloud-safe documents are serialized into immutable UTF-8 string chunks of about 180 KiB, uploaded in batches of four, and published only after all chunks are confirmed. Chunk keys include a content fingerprint, so unchanged chunks are reused by the next generation and only changed pieces consume new quota. The document key then contains a small manifest with byte length, SHA-256, chunk keys and `updatedAt`; readers reconstruct and verify the complete JSON before hydrating it. The manifest and sync marker are one CAS-protected batch, so a partially uploaded generation is never visible.
- Replacing a chunked document publishes a retirement record in the same final batch. Previous chunks remain available for two minutes so a suspended reader can finish an old snapshot; a successful large save and list-time garbage collection then remove expired, unreferenced chunks and retirement records. Uncertain network responses retain the exact chunk batches and idempotency keys for replay; definite rejection removes only the unpublished generation. The Canvas document guard is 16 MiB, while the platform's generic KV limits remain unchanged.
- Generation submissions retain their original input snapshot and idempotency identity. A lost response resumes by looking up that submission instead of issuing a new request.
- User data is scoped to the authenticated account. Switching accounts must clear or replace account-scoped state before opening another document.

## Local media lifecycle

Local media exists because a browser must be able to render an upload immediately and keep editing while the network or platform asset service is unavailable. It is a cache and recovery layer, not a second cloud identity.

```text
选择/生成媒体
  → account-scoped image/audio/video cache + local document key
  → local document save (always first)
  → pending cloud revision
  → generation/import/processing entry point uploads and confirms a platform asset
  → stable platform assetId is written to the completed node
  → storageDocument strips local bytes/keys and publishes the cloud projection
  → acknowledge the exact pending revision
```

Completed nodes never depend on a browser cache key or a short-lived delivery URL. Failed uploads roll back the new node or leave an explicit upload failure for retry. Cloud synchronization only removes browser runtime fields and projects stable identities; it does not upload, discover, or reject local media.

`src/library-store.ts` owns the local outbox revision. `src/document-storage.ts` owns the atomic document/marker write and KV revision baselines, while `src/document-sync.ts` carries low-latency same-origin window notifications. `src/cloud-document.ts` owns the cloud projection. `src/image-cache.ts`, `src/audio-cache.ts` and `src/video-cache.ts` own browser bytes. `Workspace` owns background retry and `App` owns the user-visible save state. These boundaries keep local durability, media hosting and cloud serialization separate while closing the success, retry, account-switch and cross-device recovery paths.

## Network boundary

Business requests use the App Session Gateway. Direct media fetches go through `network-boundary.ts`, which rejects control-plane paths and local/private network hosts, and accepts signed external media only through the media path. Keep this policy in sync with the host Content Security Policy; the browser boundary is defense in depth, not an IP-reputation or DNS validation service.

## Current structure and gradual cleanup

The source tree currently keeps most modules at `src/` for compatibility with existing imports and fixture scripts. `src/shared/` groups the small, side-effect-free media status/diagnostic helpers and design tokens that Canvas needs when checked out alone. This is a safe first boundary. The large editor component is still the main future extraction target; move features incrementally behind tested editor contracts rather than doing a repository-wide path churn in one change.

A practical next sequence is to extract editor panels and scene rendering, then group persistence adapters and domain services, updating tests at each step. Every extraction should preserve document serialization, undo behavior, keyboard/focus ownership, and task recovery.
