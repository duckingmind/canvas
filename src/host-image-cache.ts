import { client } from "./platform-client";
import { isSessionOnlyStorage } from "./draft-store";
import { blobToDataUrl, storeInlineImages } from "./image-cache";

/** The portal's account-scoped cache survives opaque-iframe reloads. Older
 * hosts and normal browser/desktop storage keep their existing URL path.
 */
export async function readHostCachedImage(reference: { assetId?: string; taskId?: string; resultIndex?: number }): Promise<{ image: string; localImage?: string } | undefined> {
  if (!isSessionOnlyStorage() || !client.session()?.host_capabilities?.includes("media.image.readCached")) return undefined;
  if (!reference.assetId && !reference.taskId) return undefined;
  try {
    const result = await client.platform.call<{ blob: Blob }>("media.image.readCached", reference);
    if (!(result.blob instanceof Blob) || !result.blob.type.startsWith("image/")) return undefined;
    const image = await blobToDataUrl(result.blob);
    return (await storeInlineImages({ nodes: [{ image }] })).nodes[0];
  } catch {
    return undefined;
  }
}
