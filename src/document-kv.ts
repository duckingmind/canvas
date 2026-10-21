/** The Canvas client uses the same scoped KV contract as other applications. */
export type CloudStorageEntry<T = unknown> = {
  key: string;
  value: T | null;
  revision: number;
  updatedAt?: string | null;
};
export type KVOperation =
  | { op: "put"; key: string; value: unknown; expectedRevision?: number }
  | { op: "delete"; key: string; expectedRevision?: number };
export type CloudStorage = {
  get: <T>(key: string) => Promise<T | null>;
  getMany: <T>(keys: string[]) => Promise<Record<string, T | null>>;
  getEntry: <T>(key: string) => Promise<CloudStorageEntry<T> | null>;
  set: (key: string, value: unknown, options?: { expectedRevision?: number; idempotencyKey?: string }) =>
    Promise<{ success: boolean; revision?: number }>;
  list: (options?: { prefix?: string; cursor?: string; limit?: number }) =>
    Promise<{ keys: string[]; nextCursor?: string }>;
  batch: (operations: KVOperation[], options?: { idempotencyKey?: string }) =>
    Promise<Array<{ key: string; success: boolean; revision?: number }>>;
};
export type CloudCanvasDocument = Record<string, unknown> & { id: string };
export const DOCUMENT_PREFIX = "canvas:doc:v1:";

export function canvasStorageKey(id: string): string {
  if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(id) || id.includes(".."))
    throw new Error("画布 ID 无效，无法访问云端存储。");
  return `${DOCUMENT_PREFIX}${id}`;
}

export function documentFromValue(value: unknown, id: string): CloudCanvasDocument {
  canvasStorageKey(id);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`云端画布 ${id} 缺失或格式无效。`);
  const doc = value as Record<string, unknown>;
  if (doc.id !== undefined && doc.id !== id)
    throw new Error(`云端画布 ${id} 的身份与存储键不一致。`);
  return { ...doc, id };
}

export async function listKeys(storage: CloudStorage, prefix: string) {
  const keys = new Set<string>();
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await storage.list({ prefix, cursor, limit: 100 });
    for (const key of page.keys) {
      if (!key.startsWith(prefix)) throw new Error("云端存储返回了无效的文档列表。");
      keys.add(key);
    }
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error("云端存储分页未能完成，请重试。");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return [...keys];
}
