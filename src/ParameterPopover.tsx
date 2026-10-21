import React from "react";
import { createPortal } from "react-dom";
import { isComposingKey } from "./keyboard";

export default function ParameterPopover({ anchor, id, label, onClose, children }: {
  anchor: React.RefObject<HTMLButtonElement>;
  id: string;
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panel = React.useRef<HTMLDivElement>(null);
  const close = React.useRef(onClose);
  close.current = onClose;

  React.useLayoutEffect(() => {
    const element = panel.current;
    const button = anchor.current;
    if (!element || !button) return;
    const place = () => {
      const viewport = window.visualViewport;
      const left = (viewport?.offsetLeft || 0) + 10;
      const top = (viewport?.offsetTop || 0) + 10;
      const width = (viewport?.width || window.innerWidth) - 20;
      const height = (viewport?.height || window.innerHeight) - 20;
      element.style.width = `${Math.min(344, width)}px`;
      element.classList.remove("is-compact");
      // A short landscape viewport uses columns, with no internal scroll area.
      if (element.offsetHeight > height) {
        element.classList.add("is-compact");
        element.style.width = `${Math.min(620, width)}px`;
      }
      const rect = button.getBoundingClientRect();
      const x = Math.max(left, Math.min(rect.left, left + width - element.offsetWidth));
      const above = rect.top - element.offsetHeight - 8;
      const below = rect.bottom + 8;
      const y = above >= top ? above
        : below + element.offsetHeight <= top + height ? below
        : Math.max(top, top + height - element.offsetHeight);
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
      element.style.visibility = "visible";
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    let frame = 0;
    let previousRect = "";
    const track = () => {
      const rect = button.getBoundingClientRect();
      const signature = [rect.x, rect.y, rect.width, rect.height].join(":");
      if (signature !== previousRect) { previousRect = signature; place(); }
      frame = window.requestAnimationFrame(track);
    };
    frame = window.requestAnimationFrame(track);
    const creator = button.closest(".context-creator");
    const movement = new MutationObserver(place);
    if (creator) movement.observe(creator, { attributes: true, attributeFilter: ["style", "class"] });
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    const initialFocus = element.querySelector<HTMLElement>('[data-popover-autofocus]:not(:disabled)')
      || element.querySelector<HTMLElement>('[aria-checked="true"]:not(:disabled)')
      || element.querySelector<HTMLElement>('button:not(:disabled), select:not(:disabled), textarea:not(:disabled), input:not(:disabled):not([hidden])');
    initialFocus?.focus({ preventScroll: true });
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      movement.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [anchor]);

  React.useEffect(() => {
    const dismissOutside = (event: PointerEvent | FocusEvent) => {
      if (event.target instanceof globalThis.Node &&
          !panel.current?.contains(event.target) && !anchor.current?.contains(event.target)) close.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isComposingKey(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close.current();
      anchor.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("focusin", dismissOutside);
    window.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("focusin", dismissOutside);
      window.removeEventListener("keydown", escape, true);
    };
  }, [anchor]);

  // Body portal escapes the editor's overflow, container and stacking contexts.
  return createPortal(<div ref={panel} id={id} className="context-settings-popover"
    role="dialog" aria-label={label} style={{ visibility: "hidden" }}
    onPointerDown={event => event.stopPropagation()}
    onWheel={event => event.stopPropagation()}
    onKeyDown={event => event.stopPropagation()}>{children}</div>, document.body);
}
