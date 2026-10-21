export const LOCAL_MEDIA_REFERENCE_MAX_BYTES = 64 * 1024 * 1024;

export async function localMediaDataUrl(blob: Blob, kind: "audio" | "video"): Promise<string> {
  if (!(blob instanceof Blob) || blob.size === 0) throw new Error(`本机${kind === "video" ? "视频" : "音频"}内容为空。`);
  if (blob.size > LOCAL_MEDIA_REFERENCE_MAX_BYTES) {
    throw new Error(`本机${kind === "video" ? "视频" : "音频"}超过 64 MiB，当前网关无法接收为创作参考。`);
  }
  const contentType = blob.type.trim().toLowerCase().split(";", 1)[0];
  if (!contentType.startsWith(`${kind}/`)) {
    throw new Error(`本机${kind === "video" ? "视频" : "音频"}格式无效，无法作为创作参考。`);
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}
