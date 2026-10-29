export type PopoverRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type PopoverPlacement = "above" | "below";
export type PopoverAlignment = "center" | "start" | "end" | "start-or-end";

export type PopoverPosition = {
  left: number;
  top: number;
  width: number;
  height: number;
  maxWidth: number;
  maxHeight: number;
  arrowOffset: number;
  placement: PopoverPlacement;
  side: "left" | "right";
};

export function intersectPopoverRects(left: PopoverRect, right: PopoverRect): PopoverRect {
  const x1 = Math.max(left.left, right.left);
  const y1 = Math.max(left.top, right.top);
  const x2 = Math.max(x1, Math.min(left.right, right.right));
  const y2 = Math.max(y1, Math.min(left.bottom, right.bottom));
  return { left: x1, top: y1, right: x2, bottom: y2, width: x2 - x1, height: y2 - y1 };
}

export function visiblePopoverBounds(boundary?: PopoverRect): PopoverRect {
  const viewport = window.visualViewport;
  const visible: PopoverRect = {
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
    right: (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth),
    bottom: (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight),
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
  };
  return boundary ? intersectPopoverRects(boundary, visible) : visible;
}

export function calculatePopoverPosition({
  anchor,
  bounds,
  popoverWidth,
  popoverHeight,
  preferredPlacement = "above",
  align = "center",
  gap = 8,
  edgePadding = 8,
  arrowInset = 14,
  maxHeight = Number.POSITIVE_INFINITY,
}: {
  anchor: PopoverRect;
  bounds: PopoverRect;
  popoverWidth: number;
  popoverHeight: number;
  preferredPlacement?: PopoverPlacement;
  align?: PopoverAlignment;
  gap?: number;
  edgePadding?: number;
  arrowInset?: number;
  maxHeight?: number;
}): PopoverPosition {
  const minLeft = bounds.left + edgePadding;
  const maxRight = Math.max(minLeft, bounds.right - edgePadding);
  const minTop = bounds.top + edgePadding;
  const maxBottom = Math.max(minTop, bounds.bottom - edgePadding);
  const width = Math.max(1, Math.min(Number.isFinite(popoverWidth) ? popoverWidth : 1, maxRight - minLeft));
  const naturalHeight = Math.max(1, Number.isFinite(popoverHeight) ? popoverHeight : 1);
  const aboveSpace = Math.max(0, anchor.top - gap - minTop);
  const belowSpace = Math.max(0, maxBottom - anchor.bottom - gap);
  const preferredSpace = preferredPlacement === "above" ? aboveSpace : belowSpace;
  const alternateSpace = preferredPlacement === "above" ? belowSpace : aboveSpace;
  const placement = preferredSpace >= naturalHeight
    ? preferredPlacement
    : alternateSpace >= naturalHeight
      ? (preferredPlacement === "above" ? "below" : "above")
      : preferredSpace >= alternateSpace
        ? preferredPlacement
        : (preferredPlacement === "above" ? "below" : "above");
  const availableHeight = placement === "above" ? aboveSpace : belowSpace;
  const maxPopoverHeight = Math.max(1, Math.min(maxHeight, availableHeight));
  const height = Math.min(naturalHeight, maxPopoverHeight);

  let desiredLeft: number;
  if (align === "center") desiredLeft = anchor.left + anchor.width / 2 - width / 2;
  else if (align === "end") desiredLeft = anchor.right - width;
  else if (align === "start-or-end" && anchor.left + width > maxRight) desiredLeft = anchor.right - width;
  else desiredLeft = anchor.left;
  const left = Math.max(minLeft, Math.min(desiredLeft, maxRight - width));
  const desiredTop = placement === "above" ? anchor.top - gap - height : anchor.bottom + gap;
  const top = Math.max(minTop, Math.min(desiredTop, maxBottom - height));
  const anchorCenter = anchor.left + anchor.width / 2;
  const safeArrowInset = Math.max(0, Math.min(arrowInset, width / 2));
  const arrowOffset = Math.max(safeArrowInset, Math.min(width - safeArrowInset, anchorCenter - left));

  return {
    left,
    top,
    width,
    height,
    maxWidth: Math.max(1, maxRight - minLeft),
    maxHeight: maxPopoverHeight,
    arrowOffset,
    placement,
    side: left + width / 2 >= anchorCenter ? "left" : "right",
  };
}

export function applyPopoverPosition({
  panel,
  anchor,
  arrowAnchor = anchor,
  bounds,
  preferredPlacement = "above",
  align = "center",
  gap = 8,
  edgePadding = 8,
  arrowInset = 14,
  maxHeight = Number.POSITIVE_INFINITY,
  arrowVariable,
  placementClass,
  clearTransform = true,
}: {
  panel: HTMLElement;
  anchor: HTMLElement;
  arrowAnchor?: HTMLElement;
  bounds: PopoverRect;
  preferredPlacement?: PopoverPlacement;
  align?: PopoverAlignment;
  gap?: number;
  edgePadding?: number;
  arrowInset?: number;
  maxHeight?: number;
  arrowVariable?: string;
  placementClass?: string;
  clearTransform?: boolean;
}): PopoverPosition {
  const maxWidth = Math.max(1, bounds.right - bounds.left - edgePadding * 2);
  // Clamp width before measuring content so wrapping and height selection use
  // the actual space available in the clipped canvas or visual viewport.
  panel.style.maxWidth = `${maxWidth}px`;
  const panelRect = panel.getBoundingClientRect();
  const borderHeight = Math.max(0, panel.offsetHeight - panel.clientHeight);
  const contentHeight = Math.max(panelRect.height, panel.scrollHeight + borderHeight);
  const position = calculatePopoverPosition({
    anchor: anchor.getBoundingClientRect(),
    bounds,
    popoverWidth: panelRect.width,
    popoverHeight: contentHeight,
    preferredPlacement,
    align,
    gap,
    edgePadding,
    arrowInset,
    maxHeight,
  });
  const fixed = getComputedStyle(panel).position === "fixed";
  const offsetParent = panel.offsetParent instanceof HTMLElement ? panel.offsetParent : null;
  const parentRect = !fixed && offsetParent ? offsetParent.getBoundingClientRect() : null;
  const localLeft = position.left - (parentRect?.left ?? 0) + (offsetParent?.scrollLeft ?? 0) - (offsetParent?.clientLeft ?? 0);
  const localTop = position.top - (parentRect?.top ?? 0) + (offsetParent?.scrollTop ?? 0) - (offsetParent?.clientTop ?? 0);
  panel.style.maxWidth = `${position.maxWidth}px`;
  panel.style.maxHeight = `${position.maxHeight}px`;
  panel.style.overflowY = "auto";
  panel.style.left = `${localLeft}px`;
  panel.style.top = `${localTop}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
  if (clearTransform) panel.style.transform = "none";
  panel.dataset.placement = position.placement;
  panel.dataset.side = position.side;
  if (placementClass) panel.classList.toggle(placementClass, position.placement === "below");
  if (arrowVariable) {
    const arrowRect = arrowAnchor.getBoundingClientRect();
    const arrowCenter = arrowRect.left + arrowRect.width / 2;
    const safeInset = Math.max(0, Math.min(arrowInset, position.width / 2));
    const arrowOffset = Math.max(safeInset, Math.min(position.width - safeInset, arrowCenter - position.left));
    panel.style.setProperty(arrowVariable, `${arrowOffset}px`);
  }
  return position;
}

/** Reposition anchored panels for viewport changes and anchor movement without
 * forcing every consumer to implement its own resize/scroll/visual viewport wiring. */
export function observePopoverPosition(
  anchor: HTMLElement,
  panel: HTMLElement,
  boundary: HTMLElement | null,
  update: () => void,
): () => void {
  let frame = 0;
  let previousAnchorRect = "";
  const trackAnchor = () => {
    if (!anchor.isConnected || !panel.isConnected) return;
    const rect = anchor.getBoundingClientRect();
    const signature = [rect.left, rect.top, rect.width, rect.height].join(":");
    if (signature !== previousAnchorRect) {
      previousAnchorRect = signature;
      update();
    }
    frame = window.requestAnimationFrame(trackAnchor);
  };
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
  observer?.observe(anchor);
  observer?.observe(panel);
  if (boundary) observer?.observe(boundary);
  window.addEventListener("resize", update);
  window.addEventListener("scroll", update, true);
  window.visualViewport?.addEventListener("resize", update);
  window.visualViewport?.addEventListener("scroll", update);
  frame = window.requestAnimationFrame(trackAnchor);
  return () => {
    observer?.disconnect();
    window.cancelAnimationFrame(frame);
    window.removeEventListener("resize", update);
    window.removeEventListener("scroll", update, true);
    window.visualViewport?.removeEventListener("resize", update);
    window.visualViewport?.removeEventListener("scroll", update);
  };
}
