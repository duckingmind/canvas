# Media asset library

The asset library is a reusable view of media explicitly saved by the user. Generation results remain in the canvas unless the user saves them. The platform owns asset metadata, account isolation, signed URLs and file deletion; Canvas stores stable asset identifiers and refreshes temporary URLs when needed.

## Responsibilities

- Canvas stores prompts and local-only media references in account-scoped App KV.
- The media service is the source of truth for hosted media metadata and signed access URLs.
- Removing an item from the library removes its saved status; it does not delete the hosted file or existing canvas references.
- Permanent file deletion is a separate storage operation and must be clearly confirmed by the user.
- Asset ownership and source identity are read-only to Canvas. Editable labels, categories and folders must be revision-checked by the service.

The current integration uses the Gateway media-asset endpoints provided by the host platform. Those endpoints are not served by the static Canvas build. A compatible platform session and media service are required for hosted asset operations; local drafting and exported JSON remain available without them.

## Stable references

Persist the asset ID, not an expiring signed URL. Refresh signed URLs when opening or restoring a document, and avoid matching assets by list order. Local media bytes stay in the browser cache; a document reference alone cannot restore bytes after the browser data is cleared, so the UI should explain when an item needs to be uploaded again.

## Validation

Use unit tests for account scoping, revision conflicts and URL refresh. Browser tests should use a local fixture, never a real account or production media URL. A passing fixture verifies client behavior only; host API and storage integration must be verified in the platform repository.
