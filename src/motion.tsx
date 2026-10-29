import React from "react";

export type MotionPhase = "enter" | "visible" | "exit";

const DEFAULT_DURATION = 180;

/**
 * Keep a closing surface mounted long enough for its exit animation to finish.
 * The hook is deliberately independent from canvas geometry: callers can use
 * it for screen overlays and editor surfaces without changing world transforms.
 */
export function usePresence(open: boolean, duration = DEFAULT_DURATION) {
  const [mounted, setMounted] = React.useState(open);
  const [phase, setPhase] = React.useState<MotionPhase>(open ? "enter" : "exit");

  // Run the phase transition before the browser paints. When a double-click
  // closes a surface, an effect would otherwise leave one visible frame in
  // the `visible` phase before the exit animation starts.
  React.useLayoutEffect(() => {
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let removeTimer: ReturnType<typeof setTimeout> | undefined;

    if (open) {
      setMounted(true);
      setPhase("enter");
      settleTimer = setTimeout(() => setPhase("visible"), 0);
    } else if (mounted) {
      setPhase("exit");
      removeTimer = setTimeout(() => setMounted(false), Math.max(0, duration));
    }

    return () => {
      if (settleTimer) clearTimeout(settleTimer);
      if (removeTimer) clearTimeout(removeTimer);
    };
  }, [duration, open]);

  return { mounted, phase };
}

type PresenceLayerProps = React.HTMLAttributes<HTMLDivElement> & {
  open: boolean;
  duration?: number;
  children?: React.ReactNode;
};

/**
 * A small presence boundary for layers whose children are conditionally
 * rendered. The last non-empty child is retained while `open` is false so a
 * panel fades out with its actual content instead of flashing to an empty
 * shell first.
 */
export function PresenceLayer({
  open,
  duration = DEFAULT_DURATION,
  children,
  className = "",
  ...props
}: PresenceLayerProps) {
  const presence = usePresence(open, duration);
  const lastChild = React.useRef<React.ReactNode>(null);
  // Keep state-dependent presentation modifiers with the retained content.
  // A closing lightbox changes `open` before the exit timer finishes; using
  // the new closed class here would briefly turn it into a regular modal and
  // reflow its thumbnail rail during the fade-out.
  const lastOpenClassName = React.useRef(className);
  if (open && children !== null && children !== undefined && children !== false) {
    lastChild.current = children;
  }
  if (open) lastOpenClassName.current = className;

  React.useEffect(() => {
    if (!presence.mounted) {
      lastChild.current = null;
      lastOpenClassName.current = className;
    }
  }, [className, presence.mounted]);

  if (!presence.mounted) return null;

  const content = open && children !== null && children !== undefined && children !== false
    ? children
    : lastChild.current;
  // React 18 treats `inert` as an unknown attribute and drops boolean values.
  // An empty string preserves the native boolean attribute in the DOM.
  const inertProps = {
    inert: presence.phase === "exit" ? "" : undefined,
  };
  const visibleClassName = open ? className : lastOpenClassName.current;
  return (
    <div
      {...props}
      {...inertProps}
      className={`${visibleClassName} motion-${presence.phase}`.trim()}
      data-motion-phase={presence.phase}
      aria-hidden={presence.phase === "exit" ? true : undefined}
    >
      {content}
    </div>
  );
}
