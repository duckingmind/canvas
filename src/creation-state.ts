export type CreationInputs = {
  prompt: string;
  model: string;
  references: readonly {
    nodeId: string;
    image?: string;
    localImage?: string;
    video?: string;
    localVideo?: string;
    audio?: string;
    localAudio?: string;
    videoContentUrl?: string;
    assetId?: string;
  }[];
  ignoreImageRefs?: boolean;
  settings?: Record<string, unknown>;
};

/**
 * A compact, synchronous fingerprint for the “inputs changed” UI. This is not
 * a security hash or a request idempotency key. Feed strings incrementally so
 * large local images do not become part of the saved fingerprint or require
 * another combined copy in memory. Length framing preserves field boundaries.
 */
export function creationInputSignature(input: CreationInputs): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b1;
  const feed = (value: string) => {
    const frame = `${value.length}:`;
    for (const text of [frame, value]) {
      for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        first = Math.imul(first ^ code, 0x01000193);
        second = Math.imul(second ^ code, 0x85ebca6b);
      }
    }
  };
  feed(input.prompt.trim());
  feed(input.model);
  if (input.settings) feed(JSON.stringify(input.settings));
  const references = input.ignoreImageRefs ? [] : input.references;
  feed(String(references.length));
  for (const reference of references) {
    feed(reference.nodeId);
    // A restored image and its cached copy represent one effective input.
    // Keep the cache identity only while the actual image is unavailable.
    feed(reference.image || reference.localImage || reference.video || reference.localVideo || reference.audio || reference.localAudio || reference.assetId || reference.videoContentUrl || "");
  }
  return `v1:${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

export type CreatorPanelPlacement = {
  left: number;
  top: number;
  width: number;
};

type PanelPlacementOptions = {
  width?: number;
  gap?: number;
};

const finite = (value: number | undefined, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/**
 * Position a screen-space editor below its selected node, independent of
 * canvas zoom. The editor is deliberately allowed to leave the board when
 * the node leaves the viewport: clamping it to the viewport makes it appear
 * detached while panning. `left` and `top` therefore remain in the same
 * screen coordinate system as the transformed node. Height is owned by the
 * editor's content and CSS, never by the space below its changing position.
 */
export function placeCreatorPanel(
  nodeRect: { x: number; y: number; width: number; height: number },
  board: { width: number; height: number },
  options: PanelPlacementOptions = {},
): CreatorPanelPlacement {
  const boardWidth = Math.max(0, finite(board.width, 0));
  const margin = Math.min(12, boardWidth / 2);
  const width = Math.min(
    Math.max(0, finite(options.width, 560)),
    Math.max(0, boardWidth - margin * 2),
  );
  const anchorTop =
    finite(nodeRect.y, 0) +
    Math.max(0, finite(nodeRect.height, 0)) +
    Math.max(0, finite(options.gap, 14));
  // The composer always stays below the target. It is intentionally not
  // flipped above or docked to the viewport when there is not enough room:
  // doing so breaks the visual relationship while panning a large canvas.
  const top = anchorTop;
  const center = finite(nodeRect.x, 0) + Math.max(0, finite(nodeRect.width, 0)) / 2;
  return {
    // Keep horizontal attachment even when the selected node is panned off
    // screen. The panel will naturally follow it instead of teleporting to
    // the center of the viewport.
    left: center - width / 2,
    top,
    width,
  };
}
