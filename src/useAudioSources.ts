import React from "react";
import type { CanvasNode, Document } from "./canvas-types";
import { audioSourceIdentity, canLoadAudioContent, readAudioSourceBlob, type AudioNodeSource } from "./audio-source";
import type { MusicRequest } from "./music-generation";

/** Runtime URLs never enter the persisted document, and belong to one source. */
export function useAudioSources(options: {
  document: Document; ready: boolean; api: { request: MusicRequest };
  getDocument: () => Document;
  canRead: () => boolean; fetchResource: (url: string, init?: RequestInit) => Promise<Response>;
}) {
  const current = React.useRef(options); current.current = options;
  const mounted = React.useRef(true);
  const cache = React.useRef(new Map<string, { documentId: string; identity: string; url: string; blob: Blob }>());
  const requests = React.useRef(new Map<string, { controller: AbortController; promise: Promise<boolean>; documentId: string; identity: string }>());
  const [urls, setUrls] = React.useState<Record<string, string>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState<string[]>([]);
  const clear = React.useCallback((id: string) => {
    requests.current.get(id)?.controller.abort(); requests.current.delete(id);
    const entry = cache.current.get(id); if (entry) URL.revokeObjectURL(entry.url);
    cache.current.delete(id);
    setUrls(values => { const next = { ...values }; delete next[id]; return next; });
    setErrors(values => { const next = { ...values }; delete next[id]; return next; });
    setLoading(values => values.filter(value => value !== id));
  }, []);
  const fail = React.useCallback((id: string, message: string) => {
    requests.current.get(id)?.controller.abort(); requests.current.delete(id);
    const entry = cache.current.get(id); if (entry) URL.revokeObjectURL(entry.url);
    cache.current.delete(id);
    setUrls(values => { const next = { ...values }; delete next[id]; return next; });
    setErrors(values => ({ ...values, [id]: message }));
    setLoading(values => values.filter(value => value !== id));
  }, []);
  const load = React.useCallback((node: CanvasNode, forceRefresh = false): Promise<boolean> => {
    const context = current.current, documentId = context.getDocument().id, identity = audioSourceIdentity(node);
    if (!context.ready || !context.canRead() || !canLoadAudioContent(node)) return Promise.resolve(false);
    const cached = cache.current.get(node.id);
    if (!forceRefresh && cached?.documentId === documentId && cached.identity === identity) return Promise.resolve(true);
    const pending = requests.current.get(node.id);
    if (!forceRefresh && pending?.documentId === documentId && pending.identity === identity) return pending.promise;
    clear(node.id);
    const controller = new AbortController();
    const entry = { controller, documentId, identity, promise: Promise.resolve(false) };
    const isCurrent = () => mounted.current && !controller.signal.aborted && current.current.ready && current.current.canRead() &&
      current.current.getDocument().id === documentId && requests.current.get(node.id) === entry &&
      current.current.getDocument().nodes.some(value => value.id === node.id && audioSourceIdentity(value) === identity);
    requests.current.set(node.id, entry);
    setLoading(values => [...values, node.id]);
    entry.promise = (async () => {
      try {
        const blob = await readAudioSourceBlob(context.api, node, { signal: controller.signal, forceRefresh, maxBytes: 200 * 1024 * 1024, fetchResource: context.fetchResource });
        if (!isCurrent()) return false;
        const url = URL.createObjectURL(blob);
        cache.current.set(node.id, { documentId, identity, url, blob });
        setUrls(values => ({ ...values, [node.id]: url }));
        return true;
      } catch (error) {
        if (isCurrent()) setErrors(values => ({ ...values, [node.id]: error instanceof Error ? error.message : "音频暂时无法加载，请重试。" }));
        return false;
      } finally {
        if (requests.current.get(node.id) === entry) { requests.current.delete(node.id); setLoading(values => values.filter(id => id !== node.id)); }
      }
    })();
    return entry.promise;
  }, [clear]);
  const read = React.useCallback(async (node: AudioNodeSource, signal?: AbortSignal, maxBytes = 200 * 1024 * 1024) => {
    const cached = node.id ? cache.current.get(node.id) : undefined, context = current.current;
    signal?.throwIfAborted();
    if (cached?.documentId === context.getDocument().id && cached.identity === audioSourceIdentity(node)) {
      if (cached.blob.size > maxBytes) throw Object.assign(new Error("音频超过读取大小限制"), { code: "AUDIO_CONTENT_TOO_LARGE" });
      return cached.blob;
    }
    return readAudioSourceBlob(context.api, node, { signal, maxBytes, fetchResource: context.fetchResource });
  }, []);
  React.useLayoutEffect(() => {
    for (const [id, entry] of [...cache.current, ...requests.current]) {
      const node = options.document.nodes.find(value => value.id === id);
      if (!options.ready || !node || entry.documentId !== options.document.id || entry.identity !== audioSourceIdentity(node)) clear(id);
    }
  }, [options.document, options.ready, clear]);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requests.current.forEach(entry => entry.controller.abort()); requests.current.clear();
      cache.current.forEach(entry => URL.revokeObjectURL(entry.url)); cache.current.clear();
    };
  }, []);
  return { urls, errors, loading, load, read, clear, fail };
}
