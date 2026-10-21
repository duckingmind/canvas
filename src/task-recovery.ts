/** Automatic recovery with capped backoff; only the server settles a task. */
export class TaskRecoverySchedule {
  private entries = new Map<string, { attempts: number; nextAt: number }>();
  private readonly maxDelayMs: number;
  private readonly delayMs: number;

  constructor(maxDelayMs = 30_000, delayMs = 2_000) {
    this.maxDelayMs = maxDelayMs;
    this.delayMs = delayMs;
  }

  delay(key: string, now = Date.now()): number {
    const entry = this.entries.get(key);
    if (!entry) return 0;
    return Math.max(0, entry.nextAt - now);
  }

  /** Call only after checking that the task has no active observer. */
  started(key: string, now = Date.now()): void {
    const attempts = Math.min(16, (this.entries.get(key)?.attempts || 0) + 1);
    this.entries.set(key, { attempts, nextAt: now + Math.min(this.maxDelayMs, this.delayMs * 2 ** (attempts - 1)) });
  }

  finished(key: string, now = Date.now()): void {
    const entry = this.entries.get(key);
    if (entry) entry.nextAt = now + Math.min(this.maxDelayMs, this.delayMs * 2 ** (entry.attempts - 1));
  }

  reset(key: string): void { this.entries.delete(key); }
  clear(): void { this.entries.clear(); }
  retain(keys: Set<string>): void {
    for (const key of this.entries.keys()) if (!keys.has(key)) this.entries.delete(key);
  }
}
