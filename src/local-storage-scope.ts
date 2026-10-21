/** Public, opaque account identity only. Never put a credential in this scope. */
let scope = "";
let generation = 0;
const beforeChanges = new Set<() => Promise<void>>();
export function beforeLocalAccountChange(save: () => Promise<void>): () => void {
  beforeChanges.add(save);
  return () => { beforeChanges.delete(save); };
}
export async function prepareLocalStorageScope(next: string): Promise<void> {
  if (next === scope) return;
  const check = captureLocalStorageScope();
  for (const save of [...beforeChanges]) { await save(); check(); }
}
export function localStorageScope(): string { return scope; }
export function setLocalStorageScope(next: string): boolean {
  if (!/^[A-Za-z0-9._:-]{1,256}$/.test(next)) throw new Error("平台未提供有效账户存储范围，请重新登录或更新平台。");
  if (next === scope) return false;
  scope = next;
  generation += 1;
  return true;
}
export function captureLocalStorageScope(): () => void {
  const expected = generation;
  return () => {
    if (expected !== generation) throw Object.assign(new Error("账户已切换，旧账户操作已停止。"), { code: "CANVAS_LOCAL_ACCOUNT_CHANGED" });
  };
}
export function localDatabaseName(name: string): string {
  // Unscoped v1 data is never adopted by an authenticated account. Keep it
  // untouched so a user can explicitly import an exported backup if needed.
  return scope ? `${name}:account:${scope}` : name;
}
export type ScopedMemoryOptions = {
  /** Maximum number of account partitions retained in page memory. */
  maxPartitions?: number;
};

/**
 * Keep transient browser-memory state isolated by account.
 *
 * The default is unbounded for the small coordination maps used by the
 * stores. Callers that retain potentially large values (for example image
 * data URLs) can opt into an LRU partition limit so repeated account changes
 * do not keep every account's data alive until the page is closed.
 */
export function scopedMemory<K, V>(options: ScopedMemoryOptions = {}): () => Map<K, V> {
  const maxPartitions = options.maxPartitions ?? Infinity;
  if (maxPartitions !== Infinity && (!Number.isInteger(maxPartitions) || maxPartitions < 1))
    throw new Error("账户内存分区上限必须是正整数。");
  const partitions = new Map<string, Map<K, V>>();
  return () => {
    let values = partitions.get(scope);
    if (values) {
      // Map insertion order gives us a compact LRU queue. Touching an
      // existing account keeps it alive when another account is opened.
      partitions.delete(scope);
      partitions.set(scope, values);
    } else {
      values = new Map();
      partitions.set(scope, values);
    }
    while (partitions.size > maxPartitions) {
      const oldest = partitions.keys().next().value;
      if (oldest === undefined) break;
      partitions.delete(oldest);
    }
    return values;
  };
}
