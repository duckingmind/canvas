import { useEffect, useState } from "react";
import { client } from "./platform-client";
import { readCostEstimate, readCostEstimateError, type CostEstimate, type MediaEstimateRequest } from "./cost-estimate";

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
    const controller = new AbortController();
    let current = true;
    let timeout: number | undefined;
    setResult({ key, estimate: { status: "loading" } });
    const timer = window.setTimeout(() => {
      timeout = window.setTimeout(() => {
        if (current) setResult({ key, estimate: { status: "error", reasonCode: "timeout" } });
        controller.abort();
      }, 10000);
      void client.api.request("/estimates", {
        method: "POST", body, signal: controller.signal,
      }).then(value => {
        if (current && !controller.signal.aborted) setResult({ key, estimate: readCostEstimate(value) });
      }).catch(error => {
        if (current && !controller.signal.aborted) setResult({ key, estimate: readCostEstimateError(error) });
      }).finally(() => {
        window.clearTimeout(timeout);
      });
    }, 280);
    return () => {
      current = false;
      window.clearTimeout(timer);
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [body, key]);

  // Clear the previous node/settings price in this render, before effects run.
  if (!key) return null;
  return result.key === key ? result.estimate : { status: "loading" };
}
