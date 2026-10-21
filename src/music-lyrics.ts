import type { MusicRequest } from "./music-generation.ts";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function lyricsText(value: unknown): string {
  const body = record(value);
  if (body.error || ["failed", "incomplete", "cancelled"].includes(String(body.status))) throw new Error(String(record(body.error).message || "歌词生成未完成，请重试。"));
  const direct = typeof body.output_text === "string" ? body.output_text : "";
  const output = Array.isArray(body.output) ? body.output : [];
  const text = direct || output.flatMap(item => {
    const content = record(item).content;
    return Array.isArray(content) ? content.filter(part => record(part).type === "output_text").map(part => record(part).text).filter((part): part is string => typeof part === "string") : [];
  }).join("\n");
  const clean = text.trim().replace(/^```(?:text|lyrics)?\s*\n([\s\S]*?)\n```$/i, "$1").trim();
  if (!clean) throw new Error("模型未返回歌词，请重试。");
  if ([...clean].length > 3500) throw new Error("生成的歌词过长，请缩短音乐描述后重试。");
  return clean;
}

export function lyricsModel(value: unknown): string | undefined {
  const body = record(value);
  const models = Array.isArray(value) ? value : Array.isArray(body.data) ? body.data : Array.isArray(body.items) ? body.items : [];
  const available = models.map(record).filter(model => {
    if (typeof model.id !== "string" || !model.id.trim() || model.available === false || model.supported_in_api === false || model.supports_responses === false) return false;
    if (["image", "video", "audio", "music", "embedding", "embeddings", "rerank", "reranker"].includes(String(model.type || model.model_type || "").toLowerCase())) return false;
    const outputs = model.output_modalities || record(model.architecture).output_modalities;
    if (Array.isArray(outputs) && outputs.length && !outputs.includes("text")) return false;
    const endpoints = model.supported_endpoints || record(model.capabilities).supported_endpoints;
    return !Array.isArray(endpoints) || !endpoints.length || endpoints.some(endpoint => /^\/?(?:v1\/)?responses\/?$/.test(String(endpoint)));
  });
  return String((available.find(model => model.is_default === true) || available[0])?.id || "") || undefined;
}

export async function generateMusicLyrics(request: MusicRequest, prompt: string, signal?: AbortSignal): Promise<string> {
  if (!prompt.trim()) throw new Error("请先填写音乐描述。");
  const model = lyricsModel(await request("/models", { signal }));
  if (!model) throw new Error("当前账户没有可用的歌词生成模型。");
  const response = await request("/responses", {
    method: "POST", signal, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, stream: false, store: false,
      instructions: "你是歌词创作助手。根据用户的音乐风格与主题创作可演唱的歌词。仅输出歌词，使用 [Verse]、[Chorus]、[Bridge] 等段落标签。遵循用户语言要求，未指定时使用中文，控制在 1500 字符以内。不要输出说明或 Markdown 代码块。",
      input: [{ role: "user", content: [{ type: "input_text", text: prompt.trim() }] }],
    }),
  });
  return lyricsText(response);
}
