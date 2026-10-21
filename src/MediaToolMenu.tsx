import React from "react";
import { ChevronDown, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createPortal } from "react-dom";

export type MediaToolMenuItem = {
  id: string;
  label: string;
  detail?: string;
  icon: LucideIcon;
  disabled?: boolean;
  disabledReason?: string;
  danger?: boolean;
  onSelect: () => void;
};

export type MediaToolMenuGroup = {
  label?: string;
  items: MediaToolMenuItem[];
};

type MediaToolMenuProps = {
  label: string;
  triggerLabel?: string;
  icon?: LucideIcon;
  groups: MediaToolMenuGroup[];
  disabled?: boolean;
  className?: string;
  triggerRef?: React.RefObject<HTMLButtonElement>;
};

const openMenus = new Set<() => void>();

/** Close any transient media menu before opening another tool surface. */
export function dismissMediaToolMenus() {
  [...openMenus].forEach(close => close());
}

function focusableItems(menu: HTMLDivElement | null) {
  return [...(menu?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || [])];
}

function focusMenuItem(item: HTMLButtonElement | undefined) {
  if (!item) return;
  item.focus({ preventScroll: true });
  item.scrollIntoView({ block: "nearest" });
}

export default function MediaToolMenu({ label, triggerLabel = "工具", icon: Icon = Wrench, groups, disabled = false, className, triggerRef }: MediaToolMenuProps) {
  const [open, setOpen] = React.useState(false);
  const [navigation, setNavigation] = React.useState<"pointer" | "keyboard">("pointer");
  const ownTrigger = React.useRef<HTMLButtonElement>(null);
  const trigger = triggerRef || ownTrigger;
  const menu = React.useRef<HTMLDivElement>(null);
  const arrow = React.useRef<HTMLDivElement>(null);
  const openRef = React.useRef(false);
  const pointerDriven = React.useRef(false);
  const lastPointerType = React.useRef("");
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuId = React.useId();
  const cancelClose = React.useCallback(() => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const close = React.useCallback((restoreFocus = false) => {
    cancelClose();
    openRef.current = false;
    pointerDriven.current = false;
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  }, [cancelClose, trigger]);
  const openMenu = React.useCallback((focus: "first" | "last" | null = null, touch = false) => {
    cancelClose();
    if (!openRef.current) dismissMediaToolMenus();
    pointerDriven.current = !focus && !touch;
    setNavigation(focus ? "keyboard" : "pointer");
    openRef.current = true;
    setOpen(true);
    if (focus) requestAnimationFrame(() => {
      const items = focusableItems(menu.current);
      focusMenuItem(items[focus === "last" ? items.length - 1 : 0]);
    });
  }, [cancelClose]);
  const enterHover = React.useCallback((event: React.PointerEvent) => {
    if (event.pointerType !== "mouse" || disabled) return;
    if (openRef.current) {
      cancelClose();
      return;
    }
    openMenu();
  }, [cancelClose, disabled, openMenu]);
  const leaveHover = React.useCallback((event: React.PointerEvent) => {
    if (event.pointerType !== "mouse" || !pointerDriven.current) return;
    const next = event.relatedTarget;
    if (next instanceof globalThis.Node && (trigger.current?.contains(next) || menu.current?.contains(next))) return;
    cancelClose();
    // The menu is portaled, so allow time to cross the gap from its trigger.
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      if (!pointerDriven.current) return;
      close(Boolean(menu.current?.contains(document.activeElement)));
    }, 260);
  }, [cancelClose, close, trigger]);

  React.useEffect(() => () => cancelClose(), [cancelClose]);

  React.useEffect(() => {
    if (!open) return;
    openMenus.add(close);
    return () => { openMenus.delete(close); };
  }, [open, close]);
  React.useEffect(() => { if (disabled) close(); }, [disabled, close]);
  React.useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof globalThis.Node && !trigger.current?.contains(event.target) && !menu.current?.contains(event.target)) close();
    };
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target instanceof globalThis.Node ? event.target : null;
      const inMenu = Boolean(target && (trigger.current?.contains(target) || menu.current?.contains(target)));
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close(inMenu);
        return;
      }
      if (!inMenu) return;
      if (event.key === "Tab") {
        close();
        trigger.current?.focus({ preventScroll: true });
        event.stopImmediatePropagation();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const items = focusableItems(menu.current);
      if (!items.length) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelClose();
      setNavigation("keyboard");
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : current === -1
            ? event.key === "ArrowUp" ? items.length - 1 : 0
            : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
      focusMenuItem(items[next]);
    };
    const focusChanged = (event: FocusEvent) => {
      if (event.target instanceof globalThis.Node && !trigger.current?.contains(event.target) && !menu.current?.contains(event.target)) close();
    };
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("focusin", focusChanged);
    window.addEventListener("keydown", keyboard, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("focusin", focusChanged);
      window.removeEventListener("keydown", keyboard, true);
    };
  }, [open, close, trigger, cancelClose]);
  React.useLayoutEffect(() => {
    if (!open || !menu.current || !trigger.current) return;
    const panel = menu.current;
    const anchor = trigger.current;
    const place = () => {
      const viewport = window.visualViewport;
      const leftEdge = viewport?.offsetLeft || 0;
      const topEdge = viewport?.offsetTop || 0;
      const width = viewport?.width || window.innerWidth;
      const height = viewport?.height || window.innerHeight;
      const margin = 8;
      const gap = 6;
      const rect = anchor.getBoundingClientRect();
      panel.style.maxWidth = `${Math.max(1, width - margin * 2)}px`;
      const panelWidth = Math.min(panel.offsetWidth, width - margin * 2);
      // Measure content without temporarily expanding the scroll container:
      // changing its height would clamp scrollTop and hide keyboard targets.
      const contentHeight = panel.scrollHeight + panel.offsetHeight - panel.clientHeight;
      const below = rect.bottom + gap;
      const belowSpace = topEdge + height - margin - below;
      const aboveSpace = rect.top - gap - topEdge - margin;
      const placement = contentHeight <= belowSpace || belowSpace >= aboveSpace ? "below" : "above";
      panel.style.maxHeight = `${Math.max(1, Math.min(560, height - margin * 2, placement === "below" ? belowSpace : aboveSpace))}px`;
      const panelHeight = panel.offsetHeight;
      const top = Math.max(topEdge + margin, Math.min(placement === "above" ? rect.top - panelHeight - gap : below, topEdge + height - margin - panelHeight));
      const canAlignLeft = rect.left + panelWidth <= leftEdge + width - margin;
      const canAlignRight = rect.right - panelWidth >= leftEdge + margin;
      const side = canAlignLeft || !canAlignRight ? "left" : "right";
      const preferredLeft = side === "left" ? rect.left : rect.right - panelWidth;
      const left = Math.max(leftEdge + margin, Math.min(preferredLeft, leftEdge + width - margin - panelWidth));
      const arrowCenter = Math.max(9, Math.min(panelWidth - 9, rect.left + rect.width / 2 - left));
      panel.dataset.placement = placement;
      panel.dataset.side = side;
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.setProperty("--media-menu-arrow-left", `${arrowCenter}px`);
      if (arrow.current) {
        arrow.current.dataset.placement = placement;
        arrow.current.style.left = `${left + arrowCenter - 7}px`;
        arrow.current.style.top = `${placement === "below" ? top - 7 : top + panelHeight}px`;
      }
      panel.style.visibility = "visible";
      if (arrow.current) arrow.current.style.visibility = "visible";
    };
    place();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(panel);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [open, trigger]);
  const items = groups.flatMap(group => group.items);
  return <div className={`media-tool-menu ${className || ""}`} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <button ref={trigger} type="button" className="image-tools-trigger media-tool-trigger" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} disabled={disabled}
      onPointerEnter={enterHover}
      onPointerLeave={leaveHover}
      onPointerDown={event => { lastPointerType.current = event.pointerType; }}
      onKeyDown={event => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        event.stopPropagation();
        openMenu(event.key === "ArrowDown" ? "first" : "last");
      }}
      onClick={event => {
        if (event.detail === 0) { open ? close(true) : openMenu("first"); return; }
        if (lastPointerType.current === "touch") { open ? close() : openMenu(null, true); return; }
        openMenu();
      }}>
      <Icon className="media-tool-trigger-icon" size={13} strokeWidth={1.9} aria-hidden="true" />
      <span>{triggerLabel}</span>
      <ChevronDown className="image-tools-trigger-chevron" size={12} aria-hidden="true" />
    </button>
    {open && typeof document !== "undefined" ? createPortal(<>
      <div ref={arrow} className="media-tool-menu-arrow" aria-hidden="true" style={{ visibility: "hidden" }} />
      <div ref={menu} id={menuId} className="image-tools-menu media-tool-menu-panel" role="menu" aria-label={`${label}菜单`} data-navigation={navigation} style={{ visibility: "hidden" }} onPointerEnter={enterHover} onPointerLeave={leaveHover} onPointerDown={event => event.stopPropagation()} onPointerMove={event => { if (event.pointerType === "mouse") setNavigation("pointer"); }} onWheel={event => event.stopPropagation()}>
      {groups.map((group, index) => <div key={`${group.label || "group"}-${index}`} className="media-tool-menu-group" role={group.label ? "group" : undefined} aria-label={group.label || undefined}>
        {group.label && <div className="media-tool-menu-group-title">{group.label}</div>}
        {group.items.map(item => {
          const ItemIcon = item.icon;
          const unavailable = item.disabled || Boolean(item.disabledReason);
          return <button key={item.id} type="button" role="menuitem" className={item.danger ? "danger" : undefined} disabled={unavailable} title={item.disabledReason || item.detail || item.label} aria-label={item.label} onClick={() => { close(); trigger.current?.focus({ preventScroll: true }); item.onSelect(); }}>
            <ItemIcon className="image-tools-menu-icon" size={14} strokeWidth={1.8} aria-hidden="true" /><span>{item.label}</span>
          </button>;
        })}
      </div>)}
      {!items.length && <div className="media-tool-menu-empty">暂无可用工具</div>}
      </div>
    </>, document.body) : null}
  </div>;
}
