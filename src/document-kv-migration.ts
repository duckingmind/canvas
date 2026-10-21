/** One-time, resumable migration. Normal document reads never fall back to old keys. */
import { canvasStorageKey, documentFromValue, listKeys } from "./document-kv.ts";
import type { CloudStorage, KVOperation } from "./document-kv.ts";

export const MIGRATION_KEY = "canvas:migrations:documents:v1";
const oldPrefix = "canvas:document:v4:";
const oldSingleKey = "canvas:document:v3";
const oldIndexKey = "canvas:library:v1";
const pending = new WeakMap<CloudStorage, Promise<void>>();

async function migrate(storage: CloudStorage) {
  const marker = await storage.getEntry<{ completed: boolean }>(MIGRATION_KEY);
  if (marker?.value?.completed === true) return;
  const keys = await listKeys(storage, oldPrefix);
  keys.push(oldSingleKey);
  for (const key of keys) {
    const entry = await storage.getEntry<unknown>(key);
    if (!entry) continue; // Another migration may have committed this move.
    const id = key === oldSingleKey ? "legacy-workspace" : key.slice(oldPrefix.length);
    const raw = key === oldSingleKey && entry.value && typeof entry.value === "object" && !Array.isArray(entry.value)
      ? { ...entry.value, id }
      : entry.value;
    const document = documentFromValue(raw, id);
    const destination = canvasStorageKey(id);
    const current = await storage.getEntry<unknown>(destination);
    // A new-format document always wins. Keep a conflicting old copy as an
    // explicit recovery backup rather than dropping it or resurrecting it.
    const target = current ? `canvas:backup:v1:${crypto.randomUUID()}` : destination;
    const operations: KVOperation[] = [
      { op: "put", key: target, value: current ? entry.value : document, expectedRevision: 0 },
      { op: "delete", key, expectedRevision: entry.revision },
    ];
    await storage.batch(operations);
  }
  const index = await storage.getEntry<unknown>(oldIndexKey);
  const finish: KVOperation[] = [
    { op: "put", key: MIGRATION_KEY, value: { completed: true }, expectedRevision: marker?.revision ?? 0 },
  ];
  if (index) {
    finish.unshift(
      { op: "put", key: `canvas:backup:v1:${crypto.randomUUID()}`, value: index.value, expectedRevision: 0 },
      { op: "delete", key: oldIndexKey, expectedRevision: index.revision },
    );
  }
  await storage.batch(finish);
}

export function ensureDocumentMigration(storage: CloudStorage): Promise<void> {
  const running = pending.get(storage);
  if (running) return running;
  const request = migrate(storage).finally(() => {
    if (pending.get(storage) === request) pending.delete(storage);
  });
  pending.set(storage, request);
  return request;
}
