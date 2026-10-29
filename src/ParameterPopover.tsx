import React from "react";
import { createPortal } from "react-dom";
import { isComposingKey } from "./keyboard";
import { applyPopoverPosition, observePopoverPosition, visiblePopoverBounds } from "./popover-position";

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
      const bounds = visiblePopoverBounds();
      const contentWidth = Math.max(1, bounds.width - 20);
      const contentHeight = Math.max(1, bounds.height - 20);
      element.style.removeProperty("max-height");
      element.style.removeProperty("max-width");
      element.style.overflowY = "";
      element.classList.remove("is-compact");
      element.style.width = `${Math.min(344, contentWidth)}px`;
      // A short landscape viewport uses columns before the shared geometry
      // limits the final height and makes any remaining content scrollable.
      if (element.offsetHeight > contentHeight) {
        element.classList.add("is-compact");
        element.style.width = `${Math.min(620, contentWidth)}px`;
      }
      applyPopoverPosition({
        panel: element,
        anchor: button,
        bounds,
        preferredPlacement: "above",
        align: "start",
        gap: 8,
        edgePadding: 10,
      });
      element.style.visibility = "visible";
    };
    place();
    const stopObserving = observePopoverPosition(button, element, null, place);
    const creator = button.closest(".context-creator");
    const movement = new MutationObserver(place);
    if (creator) movement.observe(creator, { attributes: true, attributeFilter: ["style", "class"] });
    const initialFocus = element.querySelector<HTMLElement>('[data-popover-autofocus]:not(:disabled)')
      || element.querySelector<HTMLElement>('[aria-checked="true"]:not(:disabled)')
      || element.querySelector<HTMLElement>('button:not(:disabled), select:not(:disabled), textarea:not(:disabled), input:not(:disabled):not([hidden])');
    initialFocus?.focus({ preventScroll: true });
    return () => {
      stopObserving();
      movement.disconnect();
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
