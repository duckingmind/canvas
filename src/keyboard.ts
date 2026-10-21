type ShortcutEvent = {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  defaultPrevented?: boolean;
  repeat?: boolean;
};

// Some IMEs report keyCode 229 even when isComposing is already false.
export function isComposingKey(event: ShortcutEvent) {
  return event.isComposing === true || event.keyCode === 229;
}

export function isGenerateShortcut(event: ShortcutEvent) {
  return !event.defaultPrevented && !event.repeat && !isComposingKey(event)
    && (event.key === "Enter" || event.code === "NumpadEnter")
    && Boolean(event.metaKey || event.ctrlKey)
    && !event.altKey && !event.shiftKey;
}

export function zoomShortcutDirection(event: ShortcutEvent): -1 | 0 | 1 {
  if (event.defaultPrevented || isComposingKey(event) || event.altKey || !(event.metaKey || event.ctrlKey)) return 0;
  if (event.key === "+" || event.key === "=" || event.key === "Add" || event.code === "NumpadAdd") return 1;
  if (event.key === "-" || event.key === "Subtract" || event.code === "NumpadSubtract") return -1;
  return 0;
}
