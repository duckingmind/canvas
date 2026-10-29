import React from "react";
import { client } from "./platform-client";
import manifest from "../manifest.json";
import { createAsset, filterAssets, isDurableAssetUrl, listAssets, normalizeAsset, normalizeAssetTags, readAsset, removeAsset, updateAsset, type AssetFilters, type AssetRow, type AssetStorage, type CanvasAsset } from "./asset-library";
import { listPlatformAssets, platformAssetToRow, readPlatformAsset, removePlatformAsset, resolvePlatformVoiceIdentity, savePlatformAsset, setPlatformAssetLibraryMembership, uploadDurablePlatformAsset } from "./platform-asset-library";
import { captureDocumentStorageSession } from "./document-storage";
import { taskImageResults, taskImageThumbnailResults } from "./image-recovery";
import { matchNodeMediaAsset, reusableNodeKind } from "./asset-nodes";
import type { CanvasNode, StoredAsset } from "./canvas-types";
import type { AssetPreview } from "./AssetLibraryPanel";
import { resolveVideoSource } from "./video-source";
import { readAudioSourceBlob } from "./audio-source";
import { fetchCanvasResource } from "./network-boundary";
import { readLocalAudio } from "./audio-cache";
import { readLocalVideo } from "./video-cache";
import { readCachedImage } from "./image-cache";

type Draft = { row: AssetRow; editing: boolean };
const messageOf = (error: unknown) => error instanceof Error ? error.message : "资产操作失败，请重试。";
const platformRow = (row: AssetRow) => row.asset.source.type === "platform" && row.asset.id.startsWith("media:");

export function useAssetLibrary(options: {
  active: boolean;
  connected: boolean;
  sessionKey: number;
  documentId: string;
  onInsert: (asset: CanvasAsset, preview: AssetPreview) => Promise<void>;
  onNotify: (message: string) => void;
  onSaved?: (asset: CanvasAsset) => void;
}) {
  const [platformRows, setPlatformRows] = React.useState<AssetRow[]>([]);
  const [localRows, setLocalRows] = React.useState<AssetRow[]>([]);
  const [filters, setFiltersState] = React.useState<AssetFilters>({});
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [hasMore, setHasMore] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string>();
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [draftPreview, setDraftPreview] = React.useState<AssetPreview>();
  const [draftError, setDraftError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const epoch = React.useRef(0);
  const loadSequence = React.useRef(0);
  const draftSequence = React.useRef(0);
  const loadingRef = React.useRef(false);
  const operationRef = React.useRef(false);
  const pagination = React.useRef({ page: 1, platformMore: true, kvMore: true, cursor: undefined as string | undefined });
  const pendingSave = React.useRef<{ signature: string; idempotencyKey: string; asset: CanvasAsset }>();
  const draftPreviewRef = React.useRef<AssetPreview>();
  const live = React.useRef(options);
  live.current = options;
  const storage = client.storage as AssetStorage;
  const replaceDraftPreview = React.useCallback((next?: AssetPreview) => {
    draftPreviewRef.current?.release?.();
    draftPreviewRef.current = next;
    setDraftPreview(next);
  }, []);

  const guard = React.useCallback(() => {
    if (!live.current.connected) throw new Error("请登录后使用资产库。");
    const captured = epoch.current;
    const checkStorage = captureDocumentStorageSession(storage);
    return () => {
      checkStorage();
      if (captured !== epoch.current || !live.current.connected) throw new Error("登录状态已更新，请重新打开资产库。");
    };
  }, [storage]);

  React.useEffect(() => {
    epoch.current += 1;
    loadSequence.current += 1;
    draftSequence.current += 1;
    loadingRef.current = false;
    operationRef.current = false;
    setPlatformRows([]); setLocalRows([]); setDraft(null); replaceDraftPreview(); setBusyId(undefined); setSaving(false);
    setError(""); setDraftError(""); setLoading(false); setHasMore(false);
    pendingSave.current = undefined;
    pagination.current = { page: 1, platformMore: true, kvMore: true, cursor: undefined };
    return () => { epoch.current += 1; loadSequence.current += 1; draftSequence.current += 1; };
  }, [options.connected, options.sessionKey, replaceDraftPreview]);

  const load = React.useCallback(async (reset = false) => {
    if (!live.current.connected || (!reset && loadingRef.current)) return;
    const sequence = ++loadSequence.current;
    const currentEpoch = epoch.current;
    loadingRef.current = true;
    setLoading(true); setError("");
    if (reset) { setPlatformRows([]); setLocalRows([]); }
    const page = reset ? { page: 1, platformMore: true, kvMore: true, cursor: undefined } : pagination.current;
    try {
      const check = guard();
      const [remoteResult, localResult] = await Promise.allSettled([
        page.platformMore ? listPlatformAssets(client.api, { ...filters, page: page.page, limit: 48 }) : null,
        page.kvMore ? listAssets(storage, { cursor: page.cursor, limit: 48 }) : null,
      ]);
      check();
      if (sequence !== loadSequence.current) return;
      const remote = remoteResult.status === "fulfilled" ? remoteResult.value : null;
      const local = localResult.status === "fulfilled" ? localResult.value : null;
      const merge = (old: AssetRow[], items: AssetRow[]) => [...new Map([...(reset ? [] : old), ...items].map(row => [row.asset.id, row])).values()];
      setPlatformRows(old => merge(old, remote?.items || []));
      setLocalRows(old => merge(old, local?.items || []));
      pagination.current = {
        page: page.page + (remote ? 1 : 0), platformMore: remote ? remote.hasMore : page.platformMore,
        kvMore: local ? Boolean(local.nextCursor) : page.kvMore, cursor: local ? local.nextCursor : page.cursor,
      };
      setHasMore(pagination.current.platformMore || pagination.current.kvMore);
      const failures = [remoteResult, localResult].flatMap(result => result.status === "rejected" ? [messageOf(result.reason)] : []);
      if (local?.skipped) failures.push(`${local.skipped} 项旧素材格式无效，未显示。`);
      if (failures.length) setError(failures.join("；"));
    } catch (failure) {
      if (sequence === loadSequence.current && currentEpoch === epoch.current) setError(messageOf(failure));
    } finally {
      if (sequence === loadSequence.current) { loadingRef.current = false; setLoading(false); }
    }
  }, [filters, guard, storage]);

  React.useEffect(() => { if (options.active && options.connected) void load(true); }, [options.active, options.connected, options.sessionKey, load]);
  const setFilters = React.useCallback((next: AssetFilters) => {
    setFiltersState(old => JSON.stringify(old) === JSON.stringify(next) ? old : next);
  }, []);

  const resolvePreview = React.useCallback(async (asset: CanvasAsset): Promise<AssetPreview> => {
    const check = guard();
    const source = asset.source;
    let url: string | undefined;
    let urlExpiresAt: string | undefined;
    if (source.type === "text") return { availability: "ready" };
    if (source.type === "local") {
      if (source.localAudio) {
        const blob = await readLocalAudio(source.localAudio);
        check();
        if (!blob) return { availability: "local-missing" };
        const previewUrl = URL.createObjectURL(blob);
        return { availability: "ready", url: previewUrl, release: () => URL.revokeObjectURL(previewUrl) };
      }
      if (source.localVideo) {
        const blob = await readLocalVideo(source.localVideo);
        check();
        if (!blob) return { availability: "local-missing" };
        const previewUrl = URL.createObjectURL(blob);
        return { availability: "ready", url: previewUrl, release: () => URL.revokeObjectURL(previewUrl) };
      }
      if (source.localImage) return { availability: "unavailable", message: "图片必须先上传到 COS 后才能使用。" };
      check();
      return { availability: "local-missing" };
    }
    if (source.type === "url") return { availability: "ready", url: source.url };
    if (asset.kind === "video" && (source.type === "platform" || source.type === "task")) {
      const delivered = await resolveVideoSource(client.api, { assetId: source.type === "platform" ? source.assetId : undefined, taskId: source.taskId });
      check();
      return { availability: "ready", url: delivered.url, urlExpiresAt: delivered.urlExpiresAt };
    }
    if (source.type === "platform") {
      const delivered = await readPlatformAsset(client.api, source.assetId);
      url = delivered.url; urlExpiresAt = delivered.urlExpiresAt;
      return url ? { availability: "ready", url, thumbnailUrl: delivered.thumbnailUrl, urlExpiresAt } : { availability: "unavailable", message: "媒体文件暂不可用，请刷新后重试。" };
    }
    else if (source.mediaType === "image") {
      const response = await client.api.request(`/images/tasks/${encodeURIComponent(source.taskId)}`);
      const index = source.resultIndex || 0;
      url = taskImageResults(response)[index];
      const thumbnailUrl = taskImageThumbnailResults(response)[index];
      check();
      return url
        ? { availability: "ready", url, thumbnailUrl, urlExpiresAt }
        : { availability: "unavailable", message: "素材暂不可用，请刷新后重试。" };
    } else if (source.mediaType === "audio") {
      const blob = await readAudioSourceBlob(client.api, {
        type: "audio", status: "completed", taskId: source.taskId,
        resultIndex: source.resultIndex, audioTaskType: source.audioTaskType || "music", voiceTrialAudioAvailable: true,
      }, {
        fetchResource: (url, init) => fetchCanvasResource(url, init, { gatewayURL: client.session()?.gateway_url }),
      });
      check();
      const previewUrl = URL.createObjectURL(blob);
      return { availability: "ready", url: previewUrl, release: () => URL.revokeObjectURL(previewUrl) };
    } else {
      // Legacy task references use authenticated task reads; new entries use asset IDs.
      const path = source.mediaType === "video" ? `/videos/${encodeURIComponent(source.taskId)}` : `/music/tasks/${encodeURIComponent(source.taskId)}`;
      const response = await client.api.request<{ content_url?: string; data?: { url?: string }[] }>(path);
      url = response.data?.[source.resultIndex || 0]?.url || response.content_url;
      if (url && !/^https?:\/\//i.test(url)) url = undefined;
    }
    check();
    return url ? { availability: "ready", url, urlExpiresAt } : { availability: "unavailable", message: "媒体文件暂不可用，请刷新后重试。" };
  }, [guard]);

  const findPlatformAsset = async (node: CanvasNode): Promise<StoredAsset | undefined> => {
    const check = guard();
    if (node.assetId) return (await readPlatformAsset(client.api, node.assetId)).storedAsset;
    const mediaURL = node.image || node.video || node.videoContentUrl || node.audio;
    if (!node.taskId && (!mediaURL || !/^https?:\/\//.test(mediaURL) || !(/\/media\//.test(mediaURL) || !isDurableAssetUrl(mediaURL)))) return;
    for (let page = 1; ; page += 1) {
      check();
      const query = new URLSearchParams({ page: String(page), limit: "100" });
      if (node.taskId) query.set("task_id", node.taskId);
      const response = await client.api.request<{ items: StoredAsset[]; total: number }>(`/media/assets?${query}`);
      check();
      const items = response.items || [];
      const match = matchNodeMediaAsset(node, items, page === 1 && response.total <= items.length);
      if (match) return match;
      if (items.length < 100 || page * 100 >= response.total) return;
    }
  };

  const openNode = async (node: CanvasNode) => {
    if (operationRef.current) return;
    operationRef.current = true;
    const currentEpoch = epoch.current, sequence = ++draftSequence.current;
    setBusyId(node.id);
    try {
      const check = guard();
      const kind = reusableNodeKind(node);
      if (!kind) throw new Error("此节点还没有可保存的内容。");
      const stored = kind === "prompt" || node.localAudio || node.localVideo ? undefined : await findPlatformAsset(node);
      check();
      let row: AssetRow;
      if (stored) {
        row = platformAssetToRow(stored);
        if (!stored.saved_to_library) row = { ...row, asset: { ...row.asset, name: node.title.slice(0, 100) || "未命名资产" } };
      } else {
        let source: CanvasAsset["source"];
        const mediaURL = node.image || node.video || node.videoContentUrl || node.audio;
        if (kind === "prompt") source = { type: "text", text: node.text };
        else if (kind === "image" && (node.localImage || node.image?.startsWith("data:image/"))) {
          throw new Error("图片必须先上传到 COS 后才能保存为资产，请重新上传图片。");
        } else if (kind === "audio" && node.localAudio) {
          if (!await readLocalAudio(node.localAudio)) throw new Error("本机音频已丢失，请重新录音或上传后保存。");
          source = { type: "local", localAudio: node.localAudio };
        } else if (kind === "video" && node.localVideo) {
          if (!await readLocalVideo(node.localVideo)) throw new Error("本机视频已丢失，请重新导入完整画布备份或重新添加视频。");
          source = { type: "local", localVideo: node.localVideo };
        } else if (kind === "audio" && node.taskId) {
          source = { type: "task", taskId: node.taskId, mediaType: "audio", ...(node.resultIndex === undefined ? {} : { resultIndex: node.resultIndex }), ...(node.audioTaskType ? { audioTaskType: node.audioTaskType } : {}), ...(node.audioTaskType === "voice_design" || node.audioTaskType === "tts" ? { voiceId: node.voiceId || node.ttsSettings?.voice_id } : {}) };
        } else if (mediaURL && isDurableAssetUrl(mediaURL)) source = { type: "url", url: mediaURL };
        else throw new Error("此内容还没有可长期使用的媒体引用，请等待生成完成或重新上传素材。");
        const timestamp = new Date().toISOString();
        row = { revision: 0, asset: normalizeAsset({
          schemaVersion: 1, id: crypto.randomUUID(), name: node.title.slice(0, 100) || "未命名资产", kind,
          category: kind === "audio" ? "sound" : kind === "prompt" ? "prompt" : "other", tags: [], folder: "",
          source, sourceAppId: manifest.id, systemTags: [`app:${manifest.id}`, `type:${kind}`, `source:${source.type === "local" ? "local" : source.type === "text" ? "text" : source.type === "task" ? "generated" : "reference"}`],
          createdAt: timestamp, updatedAt: timestamp, prompt: node.taskPrompt || node.text || undefined, modelId: node.modelId,
          origin: { documentId: live.current.documentId, nodeId: node.id },
        }) };
      }
      check();
      if (sequence !== draftSequence.current) return;
      setDraft({ row, editing: Boolean(stored?.saved_to_library) }); setDraftError(""); pendingSave.current = undefined;
      if ((row.asset.kind === "video" && node.localVideo) || (row.asset.kind === "audio" && (row.asset.source.type === "task" || row.asset.source.type === "local"))) {
        replaceDraftPreview({ availability: "unavailable", message: row.asset.kind === "video" ? "正在加载视频预览…" : "正在加载音频预览…" });
        void resolvePreview(row.asset).then(preview => {
          if (currentEpoch !== epoch.current || sequence !== draftSequence.current) { preview.release?.(); return; }
          try { check(); }
          catch { preview.release?.(); return; }
          replaceDraftPreview(preview);
        }).catch(() => {
          if (currentEpoch === epoch.current && sequence === draftSequence.current) {
            replaceDraftPreview({ availability: "unavailable", message: "预览暂不可用，仍可保存资产信息。" });
          }
        });
      } else replaceDraftPreview({ availability: "ready", url: stored?.url || node.image || node.video || node.videoContentUrl || node.audio, thumbnailUrl: stored?.thumbnail_url || node.imageThumbnail, urlExpiresAt: stored?.url_expires_at || node.videoContentUrlExpiresAt, poster: node.videoPoster });
    } catch (failure) { if (currentEpoch === epoch.current) live.current.onNotify(messageOf(failure)); }
    finally { if (currentEpoch === epoch.current) { operationRef.current = false; setBusyId(undefined); } }
  };

  const edit = async (row: AssetRow) => {
    if (operationRef.current) return;
    operationRef.current = true;
    const currentEpoch = epoch.current;
    const sequence = ++draftSequence.current;
    setBusyId(row.asset.id); setDraftError(""); replaceDraftPreview(); pendingSave.current = undefined;
    try {
      const check = guard();
      const fresh = platformRow(row) && row.asset.source.type === "platform"
        ? (await readPlatformAsset(client.api, row.asset.source.assetId)).row
        : await readAsset(storage, row.asset.id);
      check();
      if (!fresh) throw new Error("此资产已从库中移除，请刷新列表。");
      if (sequence !== draftSequence.current) return;
      let preview: AssetPreview;
      try {
        preview = await resolvePreview(fresh.asset);
      } catch { preview = { availability: "unavailable" }; }
      try { check(); }
      catch (failure) { preview.release?.(); throw failure; }
      if (sequence === draftSequence.current) {
        setDraft({ row: fresh, editing: true });
        replaceDraftPreview(preview);
      } else preview.release?.();
    } catch (failure) { if (currentEpoch === epoch.current) setError(messageOf(failure)); }
    finally { if (currentEpoch === epoch.current) { operationRef.current = false; setBusyId(undefined); } }
  };

  const save = async (value: CanvasAsset) => {
    if (!draft || operationRef.current) return;
    operationRef.current = true;
    const currentEpoch = epoch.current;
    setSaving(true); setDraftError("");
    try {
      const check = guard();
      const signature = JSON.stringify(value);
      if (pendingSave.current?.signature !== signature) pendingSave.current = {
        signature, idempotencyKey: crypto.randomUUID(), asset: normalizeAsset({ ...value, updatedAt: new Date().toISOString() }),
      };
      const pending = pendingSave.current;
      let saved: AssetRow;
      if (value.source.type === "platform") {
        const revision = platformRow(draft.row) ? draft.row.revision : (await readPlatformAsset(client.api, value.source.assetId)).row.revision;
        check();
        try { saved = await savePlatformAsset(client.api, pending.asset, revision); }
        catch (failure) {
          // A lost response may hide a committed PATCH. Read back before asking
          // for a retry; never overwrite a different concurrent edit.
          check();
          let verified: Awaited<ReturnType<typeof readPlatformAsset>> | undefined;
          try { verified = await readPlatformAsset(client.api, value.source.assetId); } catch { /* keep original failure */ }
          check();
          const latest = verified?.row.asset;
          if (!verified?.storedAsset.saved_to_library || !latest || latest.name !== pending.asset.name.trim()
            || latest.category !== pending.asset.category || (latest.folder || "") !== (pending.asset.folder || "").trim()
            || JSON.stringify(latest.tags) !== JSON.stringify(normalizeAssetTags(pending.asset.tags))) throw failure;
          saved = verified.row;
        }
        check();
        if (!platformRow(draft.row) && draft.row.revision > 0) {
          // Only remove the old KV projection once the canonical media write succeeded.
          await removeAsset(storage, draft.row.asset.id, draft.row.revision);
          check();
        }
      } else saved = draft.row.revision > 0
        ? await updateAsset(storage, pending.asset, draft.row.revision, { idempotencyKey: pending.idempotencyKey })
        : await createAsset(storage, pending.asset, { idempotencyKey: pending.idempotencyKey });
      check();
      setDraft(null); replaceDraftPreview(); pendingSave.current = undefined;
      if (platformRow(saved)) setPlatformRows(old => [saved, ...old.filter(item => item.asset.id !== saved.asset.id)]);
      else setLocalRows(old => [saved, ...old.filter(item => item.asset.id !== saved.asset.id)]);
      live.current.onSaved?.(saved.asset);
      void load(true);
    } catch (failure) { if (currentEpoch === epoch.current) setDraftError(messageOf(failure)); }
    finally { if (currentEpoch === epoch.current) { operationRef.current = false; setSaving(false); } }
  };

  const remove = async (row: AssetRow) => {
    if (operationRef.current) return;
    operationRef.current = true;
    const currentEpoch = epoch.current;
    setBusyId(row.asset.id);
    try {
      const check = guard();
      const updated = platformRow(row)
        ? await removePlatformAsset(client.api, row)
        : undefined;
      if (!updated) await removeAsset(storage, row.asset.id, row.revision);
      check();
      if (updated) setPlatformRows(old => [updated, ...old.filter(item => item.asset.id !== updated.asset.id)]);
      else setLocalRows(old => old.filter(item => item.asset.id !== row.asset.id));
      // Restart pagination after a membership change so saved-only filters
      // and server-side totals cannot skip the row that moved pages.
      void load(true);
    } catch (failure) { if (currentEpoch === epoch.current) setError(messageOf(failure)); }
    finally { if (currentEpoch === epoch.current) { operationRef.current = false; setBusyId(undefined); } }
  };

  const saveMembership = async (row: AssetRow) => {
    if (operationRef.current || !platformRow(row) || row.savedToLibrary !== false) return;
    operationRef.current = true;
    const currentEpoch = epoch.current;
    setBusyId(row.asset.id);
    try {
      const check = guard();
      const saved = await setPlatformAssetLibraryMembership(client.api, row, true);
      check();
      setPlatformRows(old => [saved, ...old.filter(item => item.asset.id !== saved.asset.id)]);
      void load(true);
    } catch (failure) {
      if (currentEpoch === epoch.current) setError(messageOf(failure));
    } finally {
      if (currentEpoch === epoch.current) { operationRef.current = false; setBusyId(undefined); }
    }
  };

  const insert = async (row: AssetRow) => {
    if (operationRef.current) return;
    operationRef.current = true;
    const currentEpoch = epoch.current, documentId = live.current.documentId;
    setBusyId(row.asset.id);
    let preview: AssetPreview | undefined;
    try {
      const check = guard();
      // KV-backed local audio/video rows are previewable in this browser, but
      // their cache keys cannot be committed as the identity of a new node.
      // Promote the bytes to a platform asset before asking the canvas to
      // insert anything. This keeps the invariant at the insertion boundary
      // instead of relying on a later sync to discover the leak.
      let insertAsset = row.asset;
      if (row.asset.source.type === "local" && (row.asset.source.localImage || row.asset.source.localAudio || row.asset.source.localVideo)) {
        const localAudio = row.asset.source.localAudio;
        const localVideo = row.asset.source.localVideo;
        const localImage = row.asset.source.localImage;
        let blob: Blob | null;
        if (localImage) {
          const dataUrl = await readCachedImage(localImage);
          blob = dataUrl ? await fetch(dataUrl).then(response => response.ok ? response.blob() : null) : null;
        } else blob = localAudio ? await readLocalAudio(localAudio) : await readLocalVideo(localVideo!);
        check();
        if (!blob) throw new Error("本机素材已丢失，请重新导入或上传后再添加。");
        const file = new File([blob], row.asset.name || `canvas-${row.asset.kind}`, {
          type: blob.type || (localImage ? "image/png" : localAudio ? "audio/mpeg" : "video/mp4"),
        });
        const uploaded = await uploadDurablePlatformAsset(client.api, {
          file,
          name: row.asset.name,
          category: row.asset.kind === "audio" ? "sound" : "other",
          idempotencyKey: `canvas-library-insert-${row.asset.id}`.slice(0, 128),
        });
        check();
        if (!uploaded.id) throw new Error("素材上传后没有返回稳定资产身份，请重试。");
        insertAsset = {
          ...row.asset,
          source: { type: "platform", assetId: uploaded.id, mediaType: localImage ? "image" : localAudio ? "audio" : "video" },
        };
      }
      preview = await resolvePreview(insertAsset);
      check();
      if (documentId !== live.current.documentId) throw new Error("画布已切换，请在当前画布重新选择资产。");
      if (preview.availability !== "ready") throw new Error(preview.message || "素材内容暂不可用。");
      const asset = { ...insertAsset, source: await resolvePlatformVoiceIdentity(client.api, insertAsset.source) } as CanvasAsset;
      check();
      await live.current.onInsert(asset, preview);
    } catch (failure) { if (currentEpoch === epoch.current) setError(messageOf(failure)); }
    finally {
      // Local media nodes retain their stable cache identity; their temporary
      // preview object URLs are no longer needed after insertion.
      preview?.release?.();
      if (currentEpoch === epoch.current) { operationRef.current = false; setBusyId(undefined); }
    }
  };

  const allRows = React.useMemo(() => {
    const ids = new Set(platformRows.map(row => row.asset.source.type === "platform" ? row.asset.source.assetId : ""));
    return [...platformRows, ...localRows.filter(row => row.asset.source.type !== "platform" || !ids.has(row.asset.source.assetId))];
  }, [platformRows, localRows]);
  const rows = React.useMemo(() => filterAssets(allRows, filters), [allRows, filters]);
  return {
    rows, loading, error, hasMore, busyId, draft, draftPreview, draftError, saving,
    knownTags: [...new Set(allRows.flatMap(row => row.asset.tags))], knownFolders: [...new Set(allRows.map(row => row.asset.folder || ""))],
    load, setFilters, resolvePreview, openNode, edit, save, saveMembership, remove, insert,
    closeDraft: () => { if (!operationRef.current) { draftSequence.current += 1; setDraft(null); replaceDraftPreview(); } },
  };
}
