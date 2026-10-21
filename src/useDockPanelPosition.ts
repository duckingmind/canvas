import React from "react";

/** Place a non-modal panel above its dock, clamped to the editor (not the page). */
export function useDockPanelPosition(
  panel: React.RefObject<HTMLElement>,
  editor: React.RefObject<HTMLElement>,
  anchorLabel: string | null,
) {
  React.useLayoutEffect(() => {
    if (!anchorLabel || !editor.current) return;
    let observer: ResizeObserver | undefined;
    let frame = 0;
    let restoreFocus: (() => void) | undefined;
    const attach = () => {
      const surface = panel.current;
      if (!surface) { frame = requestAnimationFrame(attach); return; }
      const shell = editor.current!;
      const anchor = Array.from(shell.querySelectorAll<HTMLElement>(".canvas-controls button"))
        .find(button => button.getAttribute("aria-label") === anchorLabel);
      const dock = anchor?.closest<HTMLElement>(".canvas-controls");
      if (!anchor || !dock) return;
      const position = () => {
        const bounds = shell.getBoundingClientRect();
        const dockBounds = dock.getBoundingClientRect();
        const buttonBounds = anchor.getBoundingClientRect();
        const rail = shell.querySelector<HTMLElement>(".canvas-utilities")?.getBoundingClientRect();
        const dockTop = bounds.width <= 480 && rail ? Math.min(dockBounds.top, rail.top) : dockBounds.top;
        const available = Math.max(80, dockTop - bounds.top - 24);
        surface.style.maxHeight = `${Math.min(bounds.width <= 480 ? 420 : 520, available)}px`;
        surface.style.maxWidth = `${Math.max(0, bounds.width - 24)}px`;
        const center = buttonBounds.left + buttonBounds.width / 2 - bounds.left;
        const left = Math.max(12, Math.min(center - surface.offsetWidth / 2, bounds.width - surface.offsetWidth - 12));
        surface.style.left = `${left}px`;
        surface.style.top = "auto";
        surface.style.bottom = `${bounds.bottom - dockTop + 12}px`;
        surface.style.setProperty("--dock-arrow-x", `${Math.max(18, Math.min(surface.offsetWidth - 18, center - left))}px`);
      };
      position();
      surface.focus({ preventScroll: true });
      restoreFocus = () => {
        if (surface.contains(document.activeElement)) anchor.focus({ preventScroll: true });
      };
      observer = new ResizeObserver(position);
      observer.observe(shell);
      observer.observe(dock);
      observer.observe(surface);
    };
    attach();
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); restoreFocus?.(); };
  }, [anchorLabel, panel, editor]);
}
