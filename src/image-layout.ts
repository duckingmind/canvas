export type ImageNodeSize = { width: number; height: number };

export type ImageSizeSettings = {
  aspectRatio?: string;
  size?: string;
};

const IMAGE_NODE_MAX_WIDTH = 360;
const IMAGE_NODE_MAX_HEIGHT = 600;

function imageRatio(settings: ImageSizeSettings): number | undefined {
  const aspectRatio = settings.aspectRatio?.trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (aspectRatio) {
    const width = Number(aspectRatio[1]);
    const height = Number(aspectRatio[2]);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)
      return height / width;
  }

  const size = settings.size?.trim().match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)$/i);
  if (!size) return undefined;
  const width = Number(size[1]);
  const height = Number(size[2]);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? height / width
    : undefined;
}

/** Fit a bitmap inside the canvas bounds without changing its aspect ratio. */
export function fitImageNodeSize(naturalWidth: number, naturalHeight: number): ImageNodeSize {
  const ratio = Number.isFinite(naturalWidth) && naturalWidth > 0 && Number.isFinite(naturalHeight) && naturalHeight > 0
    ? naturalHeight / naturalWidth
    : 1;
  let width = IMAGE_NODE_MAX_WIDTH;
  let height = width * ratio;
  if (height > IMAGE_NODE_MAX_HEIGHT) {
    height = IMAGE_NODE_MAX_HEIGHT;
    width = height / ratio;
  }
  return {
    // Canvas nodes have a 120px minimum edge. Supported generation ratios
    // stay well above this floor; it only protects malformed/extreme input.
    width: Math.max(120, Math.round(width)),
    height: Math.max(120, Math.round(height)),
  };
}

/** Use the known generation dimensions while a signed image preview is pending. */
export function imageNodeSizeFromSettings(settings: ImageSizeSettings): ImageNodeSize | undefined {
  const ratio = imageRatio(settings);
  return ratio ? fitImageNodeSize(1, ratio) : undefined;
}

/** Persist the output ratio so reopened and legacy nodes can recover their intended frame. */
export function imageAspectRatioFromSettings(settings: ImageSizeSettings): string | undefined {
  const aspectRatio = settings.aspectRatio?.trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (aspectRatio && Number(aspectRatio[1]) > 0 && Number(aspectRatio[2]) > 0)
    return `${aspectRatio[1]}:${aspectRatio[2]}`;

  const size = settings.size?.trim().match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)$/i);
  if (size && Number(size[1]) > 0 && Number(size[2]) > 0)
    return `${size[1]}:${size[2]}`;
  return undefined;
}

export function imageAspectRatioFromDimensions(width: number, height: number): string | undefined {
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    ? `${width}:${height}`
    : undefined;
}
