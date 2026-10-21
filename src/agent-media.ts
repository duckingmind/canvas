/** Bounded, session-scoped binary transfer. No caller supplied URLs or file paths. */
export const AGENT_MEDIA_CHUNK_BYTES = 192 * 1024
export const AGENT_IMAGE_MAX_BYTES = 8 * 1024 * 1024
export const AGENT_MEDIA_MAX_BYTES = 64 * 1024 * 1024
const MAX_TRANSFERS = 4
const TTL = 10 * 60 * 1000
const fail = (code: string, message: string): never => { throw Object.assign(new Error(message), { code, executionStarted: false }) }
export const mediaFailure = fail
export function decodeImageChunk(value: string): Uint8Array {
  if (!value || value.length > AGENT_MEDIA_CHUNK_BYTES * 4 / 3 || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail('CANVAS_MEDIA_INVALID', 'Provide a nonempty canonical base64 chunk of at most 192 KiB')
  let binary: string
  try { binary = atob(value) } catch { return fail('CANVAS_MEDIA_INVALID', 'Invalid base64') }
  if (btoa(binary) !== value) fail('CANVAS_MEDIA_INVALID', 'Noncanonical base64')
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}
export function bytesBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(binary)
}
export function imageMime(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp'
  return fail('CANVAS_MEDIA_INVALID', 'Only PNG, JPEG and WebP image bytes are supported')
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)), byte => byte.toString(16).padStart(2, '0')).join('')
}
export function createImageUploads(now = () => Date.now()) {
  const uploads = new Map<string, { documentId: string; mime: string; bytes: Uint8Array; touched: number }>()
  const expire = () => { for (const [id, item] of uploads) if (now() - item.touched > TTL) uploads.delete(id) }
  return {
    append(input: { upload_id: string; document_id: string; mime_type: string; byte_offset: number; data_base64: string }) {
      expire()
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.upload_id) || !['image/png', 'image/jpeg', 'image/webp'].includes(input.mime_type)) fail('CANVAS_MEDIA_INVALID', 'Invalid upload ID or MIME type')
      const bytes = decodeImageChunk(input.data_base64), previous = uploads.get(input.upload_id)
      if (previous && (previous.documentId !== input.document_id || previous.mime !== input.mime_type)) fail('CANVAS_MEDIA_INVALID', 'Upload belongs to a different document or media type')
      if (!Number.isSafeInteger(input.byte_offset) || input.byte_offset < 0 || input.byte_offset !== (previous?.bytes.length || 0)) fail('CANVAS_MEDIA_OFFSET', 'Append at the previously returned nextOffset; restart expired uploads with a new ID')
      if (!previous && uploads.size >= MAX_TRANSFERS) fail('CANVAS_MEDIA_LIMIT', 'At most 4 image uploads may be staged at once; import one or wait 10 minutes')
      if (input.byte_offset + bytes.length > AGENT_IMAGE_MAX_BYTES) fail('CANVAS_MEDIA_LIMIT', 'Images must be at most 8 MiB')
      const next = new Uint8Array(input.byte_offset + bytes.length)
      if (previous) next.set(previous.bytes)
      next.set(bytes, input.byte_offset)
      uploads.set(input.upload_id, { documentId: input.document_id, mime: input.mime_type, bytes: next, touched: now() })
      return { uploadId: input.upload_id, nextOffset: next.length, expiresInSeconds: TTL / 1000 }
    },
    read(id: string, documentId: string) {
      expire()
      const item = uploads.get(id)
      if (!item || item.documentId !== documentId) return fail('CANVAS_MEDIA_EXPIRED', 'Image upload expired or belongs to another document; upload again')
      if (imageMime(item.bytes) !== item.mime) fail('CANVAS_MEDIA_INVALID', 'Image bytes do not match MIME type')
      item.touched = now()
      return { ...item, dataUrl: `data:${item.mime};base64,${bytesBase64(item.bytes)}` }
    },
    remove(id: string) { uploads.delete(id) },
  }
}
export async function boundedMediaBlob(response: Response, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted()
  if (!response.ok) return fail('CANVAS_MEDIA_UNAVAILABLE', 'Media could not be read; refresh the application and retry')
  if (Number(response.headers.get('content-length')) > AGENT_MEDIA_MAX_BYTES) fail('CANVAS_MEDIA_LIMIT', 'Media exceeds the 64 MiB export limit')
  const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (!/^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm|quicktime|ogg)|audio\/(mpeg|mp3|wav|x-wav|ogg|webm|mp4|aac|flac))$/.test(mime)) fail('CANVAS_MEDIA_INVALID', 'The media response has an unsupported content type')
  const reader = response.body?.getReader()
  if (!reader) return fail('CANVAS_MEDIA_UNAVAILABLE', 'Media response has no content')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > AGENT_MEDIA_MAX_BYTES) fail('CANVAS_MEDIA_LIMIT', 'Media exceeds the 64 MiB export limit')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  if (!size) fail('CANVAS_MEDIA_UNAVAILABLE', 'Media is empty')
  return new Blob(chunks as BlobPart[], { type: mime })
}
