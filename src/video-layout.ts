const MAX_VIDEO_NODE_WIDTH = 480;
const MAX_VIDEO_NODE_HEIGHT = 360;

/** Keep the canvas video frame close to the source aspect ratio without making it enormous. */
export function fitVideoNodeSize(width: number, height: number) {
  const ratio = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    ? width / height
    : 16 / 9;
  // Fit inside the canvas bounds first. For unusually narrow media, keeping
  // the ratio and the maximum height is more useful than forcing a minimum
  // width and creating an oversized card.
  let fittedWidth = MAX_VIDEO_NODE_WIDTH;
  let fittedHeight = fittedWidth / ratio;
  if (fittedHeight > MAX_VIDEO_NODE_HEIGHT) {
    fittedHeight = MAX_VIDEO_NODE_HEIGHT;
    fittedWidth = fittedHeight * ratio;
  }
  return { width: Math.round(fittedWidth), height: Math.round(fittedHeight) };
}

export function videoAspectRatio(value: string | undefined, fallback = 16 / 9): number {
  const match = typeof value === "string" && value.trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (!match) return fallback;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : fallback;
}
