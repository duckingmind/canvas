import React from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ChevronRight, Folder, ImagePlus, Library, Search } from "lucide-react";
import type { PromptSegment } from "./canvas-types";
import { promptSegmentsText } from "./prompt-segments.ts";
import { imagePreviewURL } from "./image-variants";
import { isComposingKey, isGenerateShortcut } from "./keyboard";

export type MentionCandidate = {
  id: string;
  title: string;
  type: "note" | "prompt" | "image" | "video" | "audio";
  image?: string;
  imageThumbnail?: string;
  localImage?: string;
  assetCategory?: string;
  category?: string;
  source?: "canvas" | "library";
  assetId?: string;
};

type MentionCategory = "all" | "person" | "scene" | "object" | "style";
const MENTION_RENDER_BATCH = 12;
type Props = {
  initialSegments: PromptSegment[];
  candidates: MentionCandidate[];
  embeddedCandidates?: MentionCandidate[];
  placeholder: string;
  label: string;
  describedBy: string;
  expanded: boolean;
  referenceNaming: "name" | "number";
  onChange: (segments: PromptSegment[]) => void;
  onSelectCandidate: (id: string) => boolean | void | MentionCandidate | Promise<boolean | void | MentionCandidate>;
  onNotice?: (text: string, action?: { label: string; run: () => void }) => void;
  onLoadAssets?: () => void;
  assetsLoading?: boolean;
  assetsError?: string;
  assetsHasMore?: boolean;
  onLoadMoreAssets?: () => void;
  onRetryAssets?: () => void;
  onOpenAssetLibrary?: () => void;
  onGenerateShortcut: () => void;
  onBlur: () => void;
  onFocus?: () => void;
  inputRef: React.MutableRefObject<HTMLElement | null>;
  maxLength?: number;
};

const mentionSelector = '[data-prompt-reference="true"]';
const categoryTabs: { key: MentionCategory; label: string }[] = [
  { key: "all", label: "全部素材" },
  { key: "person", label: "人物" },
  { key: "scene", label: "场景" },
  { key: "object", label: "物品" },
  { key: "style", label: "风格" },
];

function appendText(segments: PromptSegment[], text: string) {
  if (!text) return;
  const previous = segments[segments.length - 1];
  if (previous?.type === "text") previous.text += text;
  else segments.push({ type: "text", text });
}

function readSegments(root: HTMLElement): PromptSegment[] {
  const segments: PromptSegment[] = [];
  const walk = (node: globalThis.Node) => {
    if (node.nodeType === globalThis.Node.TEXT_NODE) {
      appendText(segments, node.textContent || "");
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.matches(mentionSelector)) {
      const referenceId = node.dataset.referenceId || "";
      const label = node.dataset.referenceLabel || node.textContent?.replace(/^@/, "") || "";
      if (referenceId && label) segments.push({ type: "reference", referenceId, label });
      return;
    }
    if (node.tagName === "BR") {
      appendText(segments, "\n");
      return;
    }
    const isBlock = node !== root && ["DIV", "P"].includes(node.tagName);
    if (isBlock && segments.length) appendText(segments, "\n");
    for (const child of Array.from(node.childNodes)) walk(child);
  };
  for (const child of Array.from(root.childNodes)) walk(child);
  return segments;
}

function createMention(
  segment: Extract<PromptSegment, { type: "reference" }>,
  candidate: MentionCandidate | undefined,
  displayLabel: string,
) {
  const element = document.createElement("span");
  element.className = "context-prompt-mention";
  element.contentEditable = "false";
  element.dataset.promptReference = "true";
  element.dataset.referenceId = segment.referenceId;
  element.dataset.referenceLabel = segment.label;
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", `引用 ${displayLabel}`);
  const image = candidate && imagePreviewURL(candidate.image || candidate.localImage, candidate.imageThumbnail);
  if (image) {
    const thumbnail = document.createElement("img");
    thumbnail.src = image;
    thumbnail.alt = "";
    thumbnail.draggable = false;
    element.append(thumbnail);
  } else {
    const icon = document.createElement("span");
    icon.className = "context-prompt-mention-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "@";
    element.append(icon);
  }
  const text = document.createElement("span");
  text.className = "context-prompt-mention-label";
  text.textContent = displayLabel;
  element.append(text);
  return element;
}

function renderSegments(root: HTMLElement, segments: readonly PromptSegment[], candidates: Map<string, MentionCandidate>, naming: Props["referenceNaming"]) {
  const fragment = document.createDocumentFragment();
  let referenceNumber = 0;
  for (const segment of segments) {
    if (segment.type === "text") fragment.append(document.createTextNode(segment.text));
    else {
      referenceNumber++;
      const candidate = candidates.get(segment.referenceId);
      const label = naming === "number" ? `参考图 ${referenceNumber}` : candidate?.title || segment.label;
      fragment.append(createMention(segment, candidate, label));
    }
  }
  root.replaceChildren(fragment);
}

function activeMentionQuery(root: HTMLElement): { node: Text; start: number; query: string; range: Range } | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) return null;
  let anchor = selection.anchorNode;
  let offset = selection.anchorOffset;
  if (anchor?.nodeType !== globalThis.Node.TEXT_NODE) {
    if (!(anchor instanceof HTMLElement)) return null;
    // A caret immediately after a non-editable mention can be reported on the
    // root element rather than in the following text node. Prefer the text at
    // the caret, then the text immediately before it.
    // At the end of the editor the browser reports offset === childNodes.length.
    // In that case the caret belongs to the text node immediately before it;
    // choosing the last child as a "next" node would reset the offset to zero
    // and make a trailing @ impossible to discover.
    const nextChild = offset < anchor.childNodes.length ? anchor.childNodes[offset] : null;
    const previousChild = offset > 0 ? anchor.childNodes[offset - 1] : null;
    const child = nextChild?.nodeType === globalThis.Node.TEXT_NODE
      ? nextChild
      : previousChild?.nodeType === globalThis.Node.TEXT_NODE
        ? previousChild
        : null;
    if (child?.nodeType !== globalThis.Node.TEXT_NODE) return null;
    anchor = child;
    offset = child === nextChild ? 0 : (anchor.textContent || "").length;
  }
  const text = anchor as Text;
  if (!root.contains(text) || text.parentElement?.closest(mentionSelector)) return null;
  const beforeCaret = text.data.slice(0, offset);
  const at = beforeCaret.lastIndexOf("@");
  if (at < 0) return null;
  const query = beforeCaret.slice(at + 1);
  if (/\s/.test(query) || query.length > 80) return null;
  const range = document.createRange();
  range.setStart(text, at);
  range.setEnd(text, offset);
  return { node: text, start: at, query, range };
}

function selectionAdjacentMention(root: HTMLElement, direction: "before" | "after"): HTMLElement | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) return null;
  const { anchorNode, anchorOffset } = selection;
  if (!anchorNode || !root.contains(anchorNode)) return null;
  let candidate: globalThis.Node | null = null;
  if (anchorNode.nodeType === globalThis.Node.TEXT_NODE) {
    const text = anchorNode.textContent || "";
    if ((direction === "before" && anchorOffset !== 0) || (direction === "after" && anchorOffset !== text.length)) return null;
    candidate = direction === "before" ? anchorNode.previousSibling : anchorNode.nextSibling;
  } else if (anchorNode instanceof HTMLElement) {
    candidate = anchorNode.childNodes[direction === "before" ? anchorOffset - 1 : anchorOffset] || null;
  }
  return candidate instanceof HTMLElement && candidate.matches(mentionSelector) ? candidate : null;
}

function candidateCategory(candidate: MentionCandidate): Exclude<MentionCategory, "all"> | undefined {
  const value = (candidate.assetCategory || candidate.category || "").toLowerCase();
  if (["person", "character", "actor"].includes(value)) return "person";
  if (["scene", "location"].includes(value)) return "scene";
  if (["object", "prop", "item"].includes(value)) return "object";
  if (["style", "visual_style"].includes(value)) return "style";
  return undefined;
}

export default function PromptMentionInput(props: Props) {
  const rootRef = props.inputRef;
  const promptWrapRef = React.useRef<HTMLDivElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const libraryResultsRef = React.useRef<HTMLDivElement | null>(null);
  const categoryAnchors = React.useRef(new Map<MentionCategory, HTMLButtonElement>());
  const previewAnchor = React.useRef<HTMLElement | null>(null);
  const plainRef = React.useRef<HTMLTextAreaElement | null>(null);
  const initialHasReferences = props.initialSegments.some(segment => segment.type === "reference");
  const [inlineMode, setInlineMode] = React.useState(initialHasReferences);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState<MentionCategory>("all");
  const [libraryOpen, setLibraryOpen] = React.useState(false);
  const [hoveredCandidate, setHoveredCandidate] = React.useState<MentionCandidate | null>(null);
  const [previewFailed, setPreviewFailed] = React.useState(false);
  const [flyoutPosition, setFlyoutPosition] = React.useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const [previewPosition, setPreviewPosition] = React.useState<{ left: number; top: number; width: number } | null>(null);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [libraryVisibleCount, setLibraryVisibleCount] = React.useState(MENTION_RENDER_BATCH);
  const [selectionPending, setSelectionPending] = React.useState(false);
  const [menuPosition, setMenuPosition] = React.useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const lastNotifiedAssetsError = React.useRef("");
  const selectionPendingRef = React.useRef(false);
  const mentionRange = React.useRef<Range | null>(null);
  const plainMentionRange = React.useRef<{ start: number; end: number } | null>(null);
  const composing = React.useRef(false);
  const previousExternal = React.useRef("");
  const assetLoadRequested = React.useRef(false);
  const candidatesById = React.useMemo(() => new Map([...props.candidates, ...props.embeddedCandidates || []].map(candidate => [candidate.id, candidate])), [props.candidates, props.embeddedCandidates]);
  React.useEffect(() => {
    if (initialHasReferences) setInlineMode(true);
  }, [initialHasReferences]);
  React.useEffect(() => {
    if (!props.assetsError) {
      lastNotifiedAssetsError.current = "";
      return;
    }
    if (props.assetsError === lastNotifiedAssetsError.current) return;
    lastNotifiedAssetsError.current = props.assetsError;
    props.onNotice?.(props.assetsError, props.onRetryAssets ? { label: "重试", run: props.onRetryAssets } : undefined);
  }, [props.assetsError, props.onNotice, props.onRetryAssets]);

  const externalSignature = JSON.stringify(props.initialSegments);
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !inlineMode) return;
    const current = JSON.stringify(readSegments(root));
    if (!previousExternal.current || (externalSignature !== previousExternal.current && current !== externalSignature)) {
      renderSegments(root, props.initialSegments, candidatesById, props.referenceNaming);
    }
    previousExternal.current = externalSignature;
  }, [externalSignature, candidatesById, props.referenceNaming, props.initialSegments, rootRef, inlineMode]);

  const activeQuery = React.useCallback(() => {
    if (composing.current) return null;
    if (!inlineMode) {
      const input = plainRef.current;
      if (!input || document.activeElement !== input) return null;
      const end = input.selectionStart ?? input.value.length;
      const beforeCaret = input.value.slice(0, end);
      const at = beforeCaret.lastIndexOf("@");
      if (at < 0) return null;
      const query = beforeCaret.slice(at + 1);
      if (/\s/.test(query) || query.length > 80) return null;
      plainMentionRange.current = { start: at, end };
      return { query };
    }
    const root = rootRef.current;
    if (!root) return null;
    const value = activeMentionQuery(root);
    mentionRange.current = value?.range || null;
    return value;
  }, [rootRef, inlineMode]);
  const referenceCandidates = React.useMemo(() => {
    const references = new Map((props.embeddedCandidates || []).map(candidate => [candidate.id, candidate]));
    // References already mentioned in the text remain available. A prompt
    // can describe the same image in several places without adding it twice
    // to the submitted media inputs.
    for (const segment of props.initialSegments) {
      if (segment.type !== "reference") continue;
      const candidate = candidatesById.get(segment.referenceId);
      if (candidate) references.set(candidate.id, candidate);
    }
    return [...references.values()].filter(candidate => candidate.type === "image");
  }, [props.embeddedCandidates, props.initialSegments, candidatesById]);
  const libraryCandidates = React.useMemo(() => {
    const referenceIds = new Set(referenceCandidates.map(candidate => candidate.id));
    const assetIds = new Set(referenceCandidates.flatMap(candidate => candidate.assetId ? [candidate.assetId] : []));
    const images = new Set(referenceCandidates.flatMap(candidate => [candidate.localImage, candidate.image].filter(Boolean)));
    const seen = new Set<string>();
    return props.candidates.filter(candidate => {
      if (candidate.type !== "image" || referenceIds.has(candidate.id)) return false;
      if (candidate.assetId && assetIds.has(candidate.assetId)) return false;
      if (candidate.localImage && images.has(candidate.localImage) || candidate.image && images.has(candidate.image)) return false;
      if (!candidate.image && !candidate.imageThumbnail && !candidate.localImage && candidate.source !== "library") return false;
      const identity = candidate.assetId || candidate.localImage || candidate.id;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    }).sort((left, right) => Number(right.source === "library") - Number(left.source === "library"));
  }, [props.candidates, referenceCandidates]);
  const needle = query.trim().toLocaleLowerCase();
  const existingMatching = React.useMemo(() => referenceCandidates.filter(candidate => !needle || candidate.title.toLocaleLowerCase().includes(needle)), [referenceCandidates, needle]);
  const libraryMatching = React.useMemo(() => libraryCandidates.filter(candidate =>
    (category === "all" || candidateCategory(candidate) === category) &&
    (!needle || candidate.title.toLocaleLowerCase().includes(needle))), [libraryCandidates, category, needle]);
  const pagedAssetMatching = React.useMemo(() => libraryMatching.filter(candidate => candidate.source === "library"), [libraryMatching]);
  const displayedLibraryMatching = React.useMemo(() => libraryMatching.slice(0, libraryVisibleCount), [libraryMatching, libraryVisibleCount]);
  const libraryCountLabel = props.assetsHasMore
    ? `${displayedLibraryMatching.length}+`
    : libraryVisibleCount < libraryMatching.length
      ? `${displayedLibraryMatching.length}/${libraryMatching.length}`
      : String(libraryMatching.length);
  const matching = React.useMemo(() => libraryOpen && !needle ? displayedLibraryMatching : needle ? [...existingMatching, ...displayedLibraryMatching] : existingMatching,
    [displayedLibraryMatching, existingMatching, libraryOpen, needle]);
  React.useEffect(() => {
    setActiveIndex(0);
    setLibraryVisibleCount(MENTION_RENDER_BATCH);
  }, [query, category, libraryOpen]);
  React.useEffect(() => {
    if (activeIndex >= matching.length) setActiveIndex(Math.max(0, matching.length - 1));
  }, [activeIndex, matching.length]);

  const notifyChange = React.useCallback(() => {
    if (!inlineMode) {
      const input = plainRef.current;
      if (input) props.onChange(input.value ? [{ type: "text", text: input.value }] : []);
      return;
    }
    const root = rootRef.current;
    if (root) props.onChange(readSegments(root));
  }, [props.onChange, rootRef, inlineMode]);
  const loadMoreLibrary = () => {
    const canRevealLoaded = libraryVisibleCount < libraryMatching.length;
    const canFetchNext = libraryVisibleCount >= pagedAssetMatching.length && Boolean(props.assetsHasMore) && !props.assetsLoading;
    if (!canRevealLoaded && !canFetchNext) return;
    setLibraryVisibleCount(count => Math.min(count + MENTION_RENDER_BATCH, libraryMatching.length + MENTION_RENDER_BATCH));
    if (canFetchNext) props.onLoadMoreAssets?.();
  };
  const handleLibraryScroll = (event: React.UIEvent<HTMLElement>) => {
    const element = event.currentTarget;
    if ((libraryVisibleCount < libraryMatching.length || props.assetsHasMore) && element.scrollTop + element.clientHeight >= element.scrollHeight - 24) loadMoreLibrary();
  };
  const updateMentionSearch = () => {
    const value = activeQuery();
    setMenuOpen(Boolean(value));
    if (value) {
      if (!assetLoadRequested.current) {
        assetLoadRequested.current = true;
        props.onLoadAssets?.();
      }
      setQuery(value.query);
      setCategory("all");
      setLibraryOpen(false);
      setHoveredCandidate(null);
    } else assetLoadRequested.current = false;
  };

  // The creator editor sits inside a scrolling canvas panel. Render the menu
  // in the document layer and anchor it to the editor so the panel's overflow
  // cannot clip the candidates. Recompute on every relevant viewport change.
  const updateMenuPosition = React.useCallback(() => {
    const anchor = promptWrapRef.current;
    if (!anchor || typeof window === "undefined") return;
    const rect = anchor.getBoundingClientRect();
    const gutter = 8;
    const width = Math.min(220, window.innerWidth - gutter * 2);
    const availableHeight = Math.max(0, window.innerHeight - gutter * 2);
    const menuHeight = Math.min(menuRef.current?.scrollHeight || 360, availableHeight, 430);
    const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - gutter - 7);
    const spaceAbove = Math.max(0, rect.top - gutter - 7);
    const openAbove = spaceBelow < menuHeight && spaceAbove > spaceBelow;
    const maxHeight = Math.min(430, availableHeight, Math.max(spaceBelow, spaceAbove, Math.min(260, availableHeight)));
    const top = openAbove
      ? Math.max(gutter, rect.top - Math.min(menuHeight, maxHeight) - 7)
      : Math.min(Math.max(gutter, rect.bottom + 7), Math.max(gutter, window.innerHeight - Math.min(menuHeight, maxHeight) - gutter));
    const next = {
      left: Math.max(gutter, Math.min(rect.left, window.innerWidth - width - gutter)),
      top,
      width,
      maxHeight,
    };
    setMenuPosition(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  }, []);

  const updateFlyoutPosition = React.useCallback(() => {
    const anchor = categoryAnchors.current.get(category);
    if (!libraryOpen || !anchor || !menuRef.current) return;
    const gutter = 8;
    const rect = anchor.getBoundingClientRect();
    const menu = menuRef.current.getBoundingClientRect();
    const width = Math.min(236, window.innerWidth - gutter * 2);
    const right = menu.right + 6;
    const left = right + width <= window.innerWidth - gutter ? right
      : menu.left - width - 6 >= gutter ? menu.left - width - 6
        : Math.max(gutter, Math.min(menu.left + 22, window.innerWidth - width - gutter));
    const maxHeight = Math.min(360, window.innerHeight - gutter * 2);
    const height = Math.min(panelRef.current?.scrollHeight || 300, maxHeight);
    const next = { left, top: Math.max(gutter, Math.min(rect.top, window.innerHeight - height - gutter)), width, maxHeight };
    setFlyoutPosition(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  }, [category, libraryOpen]);

  const updatePreviewPosition = React.useCallback(() => {
    const anchor = previewAnchor.current;
    if (!hoveredCandidate || !anchor?.isConnected) return;
    const surface = anchor.closest(".prompt-mention-menu, .prompt-mention-library-panel");
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const item = anchor.getBoundingClientRect();
    const gutter = 8;
    const width = Math.min(168, window.innerWidth - gutter * 2);
    const right = rect.right + 6;
    const left = right + width <= window.innerWidth - gutter ? right : rect.left - width - 6;
    // Small screens retain the list and its labels; the preview is optional
    // and never covers the very option the user is trying to select.
    if (left < gutter) { setPreviewPosition(null); return; }
    const next = { left, top: Math.max(gutter, Math.min(item.top, window.innerHeight - width - 38 - gutter)), width };
    setPreviewPosition(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  }, [hoveredCandidate]);

  React.useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPosition(null);
      return;
    }
    updateMenuPosition();
    const handleViewportChange = () => { updateMenuPosition(); updateFlyoutPosition(); updatePreviewPosition(); };
    window.addEventListener("resize", handleViewportChange);
    // Capture scroll events from .context-creator-scroll and any other
    // ancestor because scroll events do not bubble to window.
    document.addEventListener("scroll", handleViewportChange, true);
    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(handleViewportChange)
      : null;
    if (resizeObserver) {
      if (promptWrapRef.current) resizeObserver.observe(promptWrapRef.current);
      if (menuRef.current) resizeObserver.observe(menuRef.current);
      if (panelRef.current) resizeObserver.observe(panelRef.current);
    }
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      document.removeEventListener("scroll", handleViewportChange, true);
      resizeObserver?.disconnect();
    };
  }, [menuOpen, updateMenuPosition, updateFlyoutPosition, updatePreviewPosition]);
  React.useLayoutEffect(() => { updateFlyoutPosition(); }, [updateFlyoutPosition, menuPosition, libraryMatching.length]);
  React.useLayoutEffect(() => { updatePreviewPosition(); setPreviewFailed(false); }, [updatePreviewPosition, flyoutPosition]);
  React.useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof globalThis.Node) || promptWrapRef.current?.contains(target) || menuRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setMenuOpen(false);
      setHoveredCandidate(null);
      assetLoadRequested.current = false;
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [menuOpen]);
  React.useEffect(() => {
    if (!menuOpen) return;
    const surface = libraryOpen ? panelRef.current : menuRef.current;
    surface?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, libraryOpen, menuOpen]);
  const insertMentionNow = async (candidate: MentionCandidate) => {
    const root = rootRef.current;
    const range = mentionRange.current;
    const plainRange = plainMentionRange.current;
    if (!inlineMode) {
      const input = plainRef.current;
      if (!input || !plainRange) return false;
      const selected = await props.onSelectCandidate(candidate.id);
      if (selected === false) return false;
      const resolvedCandidate = selected && typeof selected === "object" ? selected : candidate;
      const currentText = input.value;
      const segment: Extract<PromptSegment, { type: "reference" }> = { type: "reference", referenceId: resolvedCandidate.id, label: resolvedCandidate.title };
      const nextSegments: PromptSegment[] = [];
      appendText(nextSegments, currentText.slice(0, plainRange.start));
      nextSegments.push(segment);
      appendText(nextSegments, currentText.slice(plainRange.end));
      setInlineMode(true);
      props.onChange(nextSegments);
      setMenuOpen(false);
      assetLoadRequested.current = false;
      setQuery("");
      setCategory("all");
      requestAnimationFrame(() => {
        const nextRoot = rootRef.current;
        if (!nextRoot) return;
        renderSegments(nextRoot, nextSegments, new Map([...candidatesById, [resolvedCandidate.id, resolvedCandidate]]), props.referenceNaming);
        const mention = nextRoot.querySelectorAll<HTMLElement>(mentionSelector).item(nextSegments.filter(item => item.type === "reference").length - 1);
        if (mention) {
          const selection = window.getSelection();
          const nextRange = document.createRange();
          nextRange.setStartAfter(mention);
          nextRange.collapse(true);
          selection?.removeAllRanges();
          selection?.addRange(nextRange);
        }
        nextRoot.focus({ preventScroll: true });
      });
      return true;
    }
    if (!root || !range || !root.contains(range.startContainer)) return false;
    const currentSegments = readSegments(root);
    const selected = await props.onSelectCandidate(candidate.id);
    if (selected === false) return false;
    const resolvedCandidate = selected && typeof selected === "object" ? selected : candidate;
    const nextNumber = currentSegments.filter(segment => segment.type === "reference").length + 1;
    const segment: Extract<PromptSegment, { type: "reference" }> = {
      type: "reference",
      referenceId: resolvedCandidate.id,
      // Keep the canonical label stable; referenceNaming only controls the
      // compact visual caption and can be changed without rewriting prompts.
      label: resolvedCandidate.title,
    };
    range.deleteContents();
    const mention = createMention(segment, resolvedCandidate, props.referenceNaming === "number" ? `参考图 ${nextNumber}` : resolvedCandidate.title);
    range.insertNode(mention);
    range.setStartAfter(mention);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    mentionRange.current = null;
    setMenuOpen(false);
    setHoveredCandidate(null);
    assetLoadRequested.current = false;
    setQuery("");
    setCategory("all");
    notifyChange();
    root.focus({ preventScroll: true });
    return true;
  };
  const insertMention = async (candidate: MentionCandidate) => {
    if (selectionPendingRef.current) return;
    selectionPendingRef.current = true;
    setSelectionPending(true);
    try {
      const inserted = await insertMentionNow(candidate);
      if (!inserted) props.onNotice?.("素材已不可用或无法加入，请重试。");
    } catch (error) {
      props.onNotice?.(error instanceof Error ? error.message : "添加引用失败，请重试。");
    } finally {
      selectionPendingRef.current = false;
      setSelectionPending(false);
    }
  };
  const openAssetLibrary = () => {
    setMenuOpen(false);
    assetLoadRequested.current = false;
    mentionRange.current = null;
    plainMentionRange.current = null;
    props.onOpenAssetLibrary?.();
  };
  const handleInput = () => {
    notifyChange();
    updateMentionSearch();
  };
  const handleBlur = (event: React.FocusEvent<HTMLElement>) => {
    // The search field lives in the same wrapper as the editor. Moving focus
    // there must not dismiss the mention menu or persist the draft midway
    // through filtering.
    const next = event.relatedTarget;
    if (next instanceof globalThis.Node && (
      event.currentTarget.parentElement?.contains(next) ||
      menuRef.current?.contains(next) || panelRef.current?.contains(next)
    )) return;
    setMenuOpen(false);
    assetLoadRequested.current = false;
    props.onBlur();
  };
  const plainInput = (event: React.FormEvent<HTMLTextAreaElement>) => {
    props.onChange(event.currentTarget.value ? [{ type: "text", text: event.currentTarget.value }] : []);
    updateMentionSearch();
  };
  const keyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (isGenerateShortcut(event.nativeEvent)) {
      event.preventDefault();
      setMenuOpen(false);
      assetLoadRequested.current = false;
      props.onGenerateShortcut();
      return;
    }
    if (isComposingKey(event.nativeEvent)) return;
    if (selectionPending) {
      event.preventDefault();
      return;
    }
    if (menuOpen) {
      if (event.key === "ArrowRight" && !libraryOpen && !needle) {
        event.preventDefault();
        event.stopPropagation();
        setCategory("all");
        setLibraryOpen(true);
        setHoveredCandidate(null);
        return;
      }
      if ((event.key === "ArrowLeft" || event.key === "Escape") && libraryOpen) {
        event.preventDefault();
        event.stopPropagation();
        setLibraryOpen(false);
        setHoveredCandidate(null);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        if (matching.length) {
          if (event.key === "ArrowDown" && activeIndex === matching.length - 1 && libraryOpen && (libraryVisibleCount < libraryMatching.length || props.assetsHasMore)) {
            loadMoreLibrary();
            setActiveIndex(activeIndex + 1);
          } else setActiveIndex(index => (index + (event.key === "ArrowDown" ? 1 : -1) + matching.length) % matching.length);
        }
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && matching[activeIndex]) {
        event.preventDefault();
        event.stopPropagation();
        void insertMention(matching[activeIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setMenuOpen(false);
        assetLoadRequested.current = false;
        mentionRange.current = null;
        return;
      }
    }
    if (inlineMode && (event.key === "Backspace" || event.key === "Delete") && rootRef.current) {
      const target = selectionAdjacentMention(rootRef.current, event.key === "Backspace" ? "before" : "after");
      if (target) {
        event.preventDefault();
        const parent = target.parentNode;
        const index = parent ? Array.prototype.indexOf.call(parent.childNodes, target) : -1;
        target.remove();
        if (parent && index >= 0) {
          const selection = window.getSelection();
          const range = document.createRange();
          range.setStart(parent, Math.min(index, parent.childNodes.length));
          range.collapse(true);
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
        notifyChange();
        rootRef.current.focus({ preventScroll: true });
        return;
      }
    }
  };
  const renderCandidate = (candidate: MentionCandidate, index: number) => {
    const preview = imagePreviewURL(candidate.image || candidate.localImage, candidate.imageThumbnail);
    const selectableIndex = index >= 0;
    return <button key={candidate.id} type="button" role="option" aria-selected={selectableIndex && index === activeIndex} className={selectableIndex && index === activeIndex ? "is-active" : ""} disabled={selectionPending}
      onMouseEnter={event => { if (selectableIndex) setActiveIndex(index); previewAnchor.current = event.currentTarget; setHoveredCandidate(candidate); }}
      onFocus={event => { if (selectableIndex) setActiveIndex(index); previewAnchor.current = event.currentTarget; setHoveredCandidate(candidate); }}
      onClick={() => void insertMention(candidate)}>
      {preview ? <img src={preview} alt="" draggable={false} loading="lazy" /> : <span className="prompt-mention-placeholder"><ImagePlus size={13} /></span>}
      <span className="prompt-mention-option-title">{candidate.title}</span>
    </button>;
  };

  const preserveSelection = (event: React.MouseEvent) => {
    // Keep the editor caret, while allowing the search input to own focus.
    if (!(event.target instanceof HTMLElement) || !event.target.closest(".prompt-mention-search")) event.preventDefault();
  };
  const libraryStatus = <>
    {props.assetsLoading && <div className="prompt-mention-status" role="status">正在加载素材…</div>}
  </>;

  const mentionMenu = menuOpen && typeof document !== "undefined" ? createPortal(<div
    ref={menuRef}
    className="prompt-mention-menu"
    role="dialog"
    aria-label="引用素材"
    style={menuPosition ? {
      left: menuPosition.left,
      top: menuPosition.top,
      width: menuPosition.width,
      maxHeight: menuPosition.maxHeight,
      visibility: menuPosition ? "visible" : "hidden",
    } : { visibility: "hidden" }}
    onKeyDown={keyDown}
    onMouseDown={preserveSelection}
  >
    <label className="prompt-mention-search">
      <span className="sr-only">筛选引用素材</span>
      <Search size={13} aria-hidden="true" />
      <input aria-label="筛选引用素材" value={query} onFocus={() => { setLibraryOpen(false); setHoveredCandidate(null); }} onChange={event => { setQuery(event.target.value); setCategory("all"); }} placeholder="搜索素材" />
    </label>
    <div className="prompt-mention-results" onScroll={event => {
      const element = event.currentTarget;
      if (needle && element.scrollTop + element.clientHeight >= element.scrollHeight - 24 && (libraryVisibleCount < libraryMatching.length || props.assetsHasMore)) loadMoreLibrary();
    }}>
      <section className="prompt-mention-section" onMouseEnter={() => { if (!needle) setLibraryOpen(false); }}>
        <div className="prompt-mention-section-head">
          <span>当前已有引用</span>
          <span className="prompt-mention-section-count">{existingMatching.length}</span>
        </div>
        <div className="prompt-mention-options is-existing" role="listbox" aria-label="当前已有引用">
          {existingMatching.map(candidate => {
            const index = matching.indexOf(candidate);
            return renderCandidate(candidate, index);
          })}
          {existingMatching.length === 0 && <p>{needle ? "没有匹配的已有引用" : "暂无已有引用"}</p>}
        </div>
      </section>
      <section className="prompt-mention-section">
        <div className="prompt-mention-section-head">
          <span>素材库</span>
          <span className="prompt-mention-source">当前应用 · 当前画布</span>
        </div>
        {needle ? <>
          <div className="prompt-mention-options" role="listbox" aria-label="素材搜索结果">
            {displayedLibraryMatching.map(candidate => {
              const index = matching.indexOf(candidate);
              return renderCandidate(candidate, index);
            })}
            {libraryMatching.length === 0 && <p>{props.assetsHasMore ? "已加载素材中没有匹配项" : "没有找到匹配的素材"}</p>}
          </div>
          {(libraryVisibleCount < libraryMatching.length || props.assetsHasMore) && <button type="button" className="prompt-mention-load-more" disabled={props.assetsLoading && libraryVisibleCount >= libraryMatching.length} onClick={loadMoreLibrary}>{props.assetsLoading ? "正在加载…" : "滚动或点击加载更多素材"}</button>}
          {libraryStatus}
        </> : <div className="prompt-mention-categories" aria-label="素材类别">
          {categoryTabs.map(tab => <button key={tab.key} type="button"
            ref={element => { if (element) categoryAnchors.current.set(tab.key, element); else categoryAnchors.current.delete(tab.key); }}
            aria-haspopup="dialog" aria-expanded={libraryOpen && category === tab.key}
            className={libraryOpen && category === tab.key ? "is-active" : ""}
            onMouseEnter={() => { setCategory(tab.key); setLibraryOpen(true); setHoveredCandidate(null); }}
            onClick={() => { setCategory(tab.key); setLibraryOpen(true); setHoveredCandidate(null); }}
          ><Folder size={13} /><span>{tab.label}</span><ChevronRight size={12} /></button>)}
        </div>}
      </section>
    </div>
    {!needle && props.assetsLoading && <div className="prompt-mention-status" role="status">正在加载素材…</div>}
    {selectionPending && <div className="prompt-mention-status">正在加入素材…</div>}
    {props.onOpenAssetLibrary && <button type="button" className="prompt-mention-open-library" onClick={openAssetLibrary}><Library size={13} aria-hidden="true" />打开完整素材库</button>}
    <div className="prompt-mention-hint">↑↓ 选择 · → 素材库 · Enter 插入</div>
  </div>, document.body) : null;

  const libraryMenu = menuOpen && libraryOpen && !needle && typeof document !== "undefined" ? createPortal(<div
    ref={panelRef} className="prompt-mention-library-panel" role="dialog"
    aria-label={`${categoryTabs.find(tab => tab.key === category)?.label || "全部素材"}素材`}
    style={flyoutPosition ? flyoutPosition : { visibility: "hidden" }}
    onMouseDown={preserveSelection} onKeyDown={keyDown}
    onMouseLeave={() => setHoveredCandidate(null)}
  >
    <div className="prompt-mention-library-head"><button type="button" aria-label="返回引用菜单" onClick={() => { setLibraryOpen(false); setHoveredCandidate(null); }}><ArrowLeft size={13} /></button><span>{categoryTabs.find(tab => tab.key === category)?.label}</span><span className="prompt-mention-section-count">{libraryCountLabel}</span></div>
    <div ref={libraryResultsRef} className="prompt-mention-library-results" onScroll={handleLibraryScroll}>
      <div className="prompt-mention-options" role="listbox" aria-label="分类素材">{displayedLibraryMatching.map((candidate, index) => renderCandidate(candidate, index))}
        {libraryMatching.length === 0 && <p>{props.assetsLoading ? "正在查找素材…" : props.assetsHasMore ? "已加载素材中暂无此分类" : "暂无此分类素材"}</p>}
      </div>
      {(libraryVisibleCount < libraryMatching.length || props.assetsHasMore) && <button type="button" className="prompt-mention-load-more" disabled={props.assetsLoading && libraryVisibleCount >= libraryMatching.length} onClick={loadMoreLibrary}>{props.assetsLoading ? "正在加载…" : "滚动或点击加载更多素材"}</button>}
      {libraryStatus}
    </div>
  </div>, document.body) : null;
  const hoveredPreview = hoveredCandidate && imagePreviewURL(hoveredCandidate.image || hoveredCandidate.localImage, hoveredCandidate.imageThumbnail);
  const candidatePreview = menuOpen && hoveredCandidate && hoveredPreview && !previewFailed && previewPosition && typeof document !== "undefined"
    ? createPortal(<figure className="prompt-mention-hover-preview" aria-label="引用素材预览" style={previewPosition}>
      <img src={hoveredPreview} alt={hoveredCandidate.title} draggable={false} onError={() => setPreviewFailed(true)} />
      <figcaption>{hoveredCandidate.title}</figcaption>
    </figure>, document.body) : null;

  return <div ref={promptWrapRef} className="context-prompt-wrap">
    {!inlineMode ? <textarea
      ref={node => { plainRef.current = node; props.inputRef.current = node; }}
      className="context-prompt"
      aria-label={props.label}
      aria-describedby={props.describedBy}
      placeholder={props.placeholder}
      value={props.initialSegments.map(segment => segment.type === "text" ? segment.text : `@${segment.label}`).join("")}
      maxLength={props.maxLength ?? 20000}
      rows={props.expanded ? 9 : 3}
      onChange={plainInput}
      onKeyDown={keyDown}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; updateMentionSearch(); }}
      onBlur={handleBlur}
      onFocus={props.onFocus}
    /> : <div
      ref={node => { props.inputRef.current = node; }}
      className={`context-prompt${props.expanded ? " is-expanded" : ""}`}
      role="textbox"
      aria-label={props.label}
      aria-describedby={props.describedBy}
      aria-multiline="true"
      aria-placeholder={props.placeholder}
      data-placeholder={props.placeholder}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      onInput={handleInput}
      onKeyDown={keyDown}
      onPaste={event => {
        event.preventDefault();
        const text = event.clipboardData.getData("text/plain");
        document.execCommand("insertText", false, text);
      }}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; updateMentionSearch(); }}
      onBlur={handleBlur}
      onFocus={props.onFocus}
      onClick={() => updateMentionSearch()}
    />}
    {mentionMenu}
    {libraryMenu}
    {candidatePreview}
    {referenceCandidates.length > 0 && <span className="sr-only" aria-live="polite">已引用 {referenceCandidates.length} 个素材</span>}
  </div>;
}

export { promptSegmentsText };
