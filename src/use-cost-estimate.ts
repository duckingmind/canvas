import { useEffect, useState } from "react";
import { client } from "./platform-client";
import { readCostEstimate, readCostEstimateError, type CostEstimate, type MediaEstimateRequest } from "./cost-estimate";
import { scopedMemory } from "./local-storage-scope";

// Estimates are advisory UI data. A very short browser cache and shared
// in-flight request keep multiple nodes with the same settings from asking the
// gateway to repeat the same routing work while still reflecting price changes
// quickly.
const ESTIMATE_CACHE_TTL_MS = 5_000;
const ESTIMATE_ERROR_CACHE_TTL_MS = 1_000;
const MAX_ESTIMATE_CACHE_ENTRIES = 128;

type CachedEstimate = { estimate: CostEstimate; expiresAt: number };
type InflightEstimate = {
  promise: Promise<CostEstimate>;
  controller: AbortController;
  subscribers: number;
};
const estimateCache = scopedMemory<string, CachedEstimate>({ maxPartitions: 2 });
const estimateInflight = scopedMemory<string, InflightEstimate>({ maxPartitions: 2 });

function cacheEstimate(cache: Map<string, CachedEstimate>, key: string, estimate: CostEstimate): void {
  if (cache.size >= MAX_ESTIMATE_CACHE_ENTRIES && !cache.has(key)) {
    const oldest = cache.keys().next().value;
    if (typeof oldest === "string") cache.delete(oldest);
  }
  const ttl = estimate.status === "error" ? ESTIMATE_ERROR_CACHE_TTL_MS : ESTIMATE_CACHE_TTL_MS;
  cache.delete(key);
  cache.set(key, { estimate, expiresAt: Date.now() + ttl });
}

function subscribeEstimate(body: string): { promise: Promise<CostEstimate>; release: () => void } {
  const now = Date.now();
  const cache = estimateCache();
  const inflight = estimateInflight();
  const cached = cache.get(body);
  if (cached) {
    if (cached.expiresAt > now) {
      // Refresh insertion order so active keys are retained when the bound is hit.
      cache.delete(body);
      cache.set(body, cached);
      return { promise: Promise.resolve(cached.estimate), release: () => {} };
    }
    cache.delete(body);
  }
  const existing = inflight.get(body);
  if (existing && !existing.controller.signal.aborted) {
    existing.subscribers += 1;
    return {
      promise: existing.promise,
      release: () => releaseEstimate(body, existing, inflight),
    };
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  const entry: InflightEstimate = { promise: Promise.resolve({ status: "loading" }), controller, subscribers: 1 };
  entry.promise = client.api.request("/estimates", { method: "POST", body, signal: controller.signal })
    .then(readCostEstimate)
    .catch(error => controller.signal.aborted
      ? { status: "error", reasonCode: "timeout" } as CostEstimate
      : readCostEstimateError(error))
    .then(estimate => {
      if (!controller.signal.aborted) cacheEstimate(cache, body, estimate);
      return estimate;
    })
    .finally(() => {
      window.clearTimeout(timeout);
      if (inflight.get(body) === entry) inflight.delete(body);
    });
  inflight.set(body, entry);
  return {
    promise: entry.promise,
    release: () => releaseEstimate(body, entry, inflight),
  };
}

function releaseEstimate(body: string, entry: InflightEstimate, inflight: Map<string, InflightEstimate>): void {
  entry.subscribers = Math.max(0, entry.subscribers - 1);
  if (entry.subscribers === 0 && inflight.get(body) === entry) entry.controller.abort();
}

/** A node owns its estimate; equal pricing inputs do not restart the request. */
export function useCostEstimate(nodeId: string, request: MediaEstimateRequest | null): CostEstimate | null {
  const body = request ? JSON.stringify(request) : null;
  const key = body ? JSON.stringify([nodeId, body]) : null;
  const [result, setResult] = useState<{ key: string | null; estimate: CostEstimate }>({
    key: null, estimate: { status: "loading" },
  });

  useEffect(() => {
    if (!body || !key) {
      setResult(previous => previous.key === null ? previous : { key: null, estimate: { status: "loading" } });
      return;
    }
    let current = true;
    let timeout: number | undefined;
    let subscription: ReturnType<typeof subscribeEstimate> | undefined;
    setResult({ key, estimate: { status: "loading" } });
    const timer = window.setTimeout(() => {
      timeout = window.setTimeout(() => {
        if (current) setResult({ key, estimate: { status: "error", reasonCode: "timeout" } });
      }, 10_000);
      subscription = subscribeEstimate(body);
      void subscription.promise.then(estimate => {
        if (current) setResult({ key, estimate });
      }).finally(() => window.clearTimeout(timeout));
    }, 280);
    return () => {
      current = false;
      window.clearTimeout(timer);
      window.clearTimeout(timeout);
      subscription?.release();
    };
  }, [body, key]);

  // Clear the previous node/settings price in this render, before effects run.
  if (!key) return null;
  return result.key === key ? result.estimate : { status: "loading" };
}
