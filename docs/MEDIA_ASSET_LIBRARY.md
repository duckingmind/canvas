# Media asset library

The asset library is a reusable view of media explicitly saved by the user. Generation results remain in the canvas unless the user saves them. The platform owns asset metadata, account isolation, signed URLs and file deletion; Canvas stores stable asset identifiers and refreshes temporary URLs when needed.

## User workflow

- **Canvas materials** are the media nodes in one canvas. Select a reusable node and choose **Save as asset** in its quick toolbar to add it to the account-wide library.
- **Asset library** contains items explicitly saved for reuse. From there, add an item to the current canvas or another canvas; the inserted node keeps the stable platform asset ID.
- A successful save offers **Open asset library** so users can immediately find and reuse the saved item. Removing it from the library only removes the saved membership; it does not delete media or canvas nodes.

## Responsibilities

- Canvas stores prompts and local-only media references in account-scoped App KV.
- The media service is the source of truth for hosted media metadata and signed access URLs.
- Removing an item from the library removes its saved status; it does not delete the hosted file or existing canvas references.
- Permanent file deletion is a separate storage operation and must be clearly confirmed by the user.
- Asset ownership and source identity are read-only to Canvas. Editable labels, categories and folders must be revision-checked by the service.

The current integration uses the Gateway media-asset endpoints provided by the host platform. Those endpoints are not served by the static Canvas build. A compatible platform session and media service are required for hosted asset operations; local drafting and exported JSON remain available without them.

## Stable references

Persist the asset ID, not an expiring signed URL. Refresh signed URLs when opening or restoring a document, and avoid matching assets by list order. Local media bytes stay in the browser cache; a document reference alone cannot restore bytes after the browser data is cleared, so the UI should explain when an item needs to be uploaded again.

Canvas uploads browser-local image, video and audio references at the generation, import, processing, copy, library-insert, or reference-binding entry point that creates the completed node. A local cache key is used for immediate playback and is never a cloud identity. The upload must return a platform asset ID before the node or reference is marked complete. Cloud synchronization only projects the document and never uploads, discovers, or rejects local media. Audio/video cache keys may remain as optional same-browser hints beside a stable asset or task identity; they are not required on another device.

Durable browser media now uses a direct object-storage upload regardless of file size. The shared App SDK owns the upload-intent, COS PUT, completion, and abort flow. Canvas and Chat both use this implementation for reusable media. It first requests an upload intent from
`POST /media/assets/upload-intents`, sends the file with `PUT upload_url`, and confirms it with
`POST /media/assets/{asset_id}/complete`. The Gateway validates the object metadata before promoting the
staging object, and an interrupted intent can be aborted with
`DELETE /media/assets/{asset_id}/upload-intent`. This path is used for media that must be restored,
reused as a reference, synchronized to another device, or retained as a platform asset. Upload-intent,
COS transfer, and completion failures are returned to the caller; the file is never replayed through
the Gateway. One-shot upstream inputs, such as image-edit reference files, remain on their
operation-specific multipart request and do not enter the asset library.

The image-edit operation itself accepts reference bytes as multipart at `/images/edits`; this
operation request does not create an asset. A reference kept in a Canvas document is reusable and
must remain recoverable after sync, so Canvas stores that durable reference through the COS asset
path as well. The transport decision follows whether the media is a durable asset or an operation
input, never the image's size. Chat attachments and other media retained beyond one request also use
the shared COS asset path.

The object-storage bucket needs CORS for the deployed Canvas origins. Allow `OPTIONS` and `PUT`, permit
`Content-Type`, and expose the PUT response status. Gateway CORS settings do not configure COS CORS.

## Validation

Use unit tests for account scoping, revision conflicts and URL refresh. Browser tests should use a local fixture, never a real account or production media URL. Run `npm run test:e2e:cloud-media` to verify that cloud projection strips temporary fields without starting a media upload. A passing fixture verifies client behavior only; host API and storage integration must be verified in the platform repository.
