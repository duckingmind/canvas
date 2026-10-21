import type { Viewport } from "./geometry";

export type ViewportMotionMode = "direct" | "wheel" | "navigate";
type Options = { mode?: ViewportMotionMode; edited?: boolean };
type Environment = {
  read: () => Viewport;
  render: (viewport: Viewport, edited: boolean, mode: ViewportMotionMode) => void;
  requestFrame: (callback: (time: number) => void) => number;
  cancelFrame: (id: number) => void;
  now: () => number;
  reducedMotion: () => boolean;
};
type Motion = {
  from: Viewport;
  target: Viewport;
  mode: ViewportMotionMode;
  started: number;
  edited: boolean;
};

const duration = { direct: 0, wheel: 0, navigate: 220 };
const same = (a: Viewport, b: Viewport) => a.x === b.x && a.y === b.y && a.zoom === b.zoom;

/**
 * One camera for world geometry, overlays and hit testing. Direct manipulation
 * is synchronous; wheel steps are frame-batched without an extra animation
 * tail; explicit navigation has a short, interruptible ease-out. Never add CSS
 * transitions to individual layers. Trackpad momentum already arrives as wheel
 * events, so no velocity/inertia is synthesized here.
 */
export class ViewportMotion {
  private frame: number | null = null;
  private motion: Motion | null = null;
  private readonly env: Environment;

  constructor(env: Environment) { this.env = env; }

  /** Accumulate a burst of wheel events without losing unpainted deltas. */
  target(mode: ViewportMotionMode): Viewport {
    return this.motion?.mode === mode ? this.motion.target : this.env.read();
  }

  move(target: Viewport, { mode = "direct", edited = true }: Options = {}) {
    if (![target.x, target.y, target.zoom].every(Number.isFinite) || target.zoom <= 0) return;
    if (this.motion && this.motion.mode !== mode) this.stop();
    if (mode === "direct") {
      this.cancel();
      if (!same(this.env.read(), target)) this.env.render(target, edited, mode);
      return;
    }
    const from = this.env.read();
    // Preserve unsaved direct input if a resize joins the same frame.
    const shouldEdit = edited || Boolean(this.motion?.edited);
    this.motion = same(from, target) ? null : {
      from: { ...from }, target: { ...target }, mode,
      started: this.env.now(), edited: shouldEdit,
    };
    if (this.motion && this.frame === null) this.frame = this.env.requestFrame(this.tick);
  }

  /** A new gesture takes over the displayed position, never an unseen endpoint. */
  stop() {
    const pending = this.motion;
    this.cancel();
    // Releasing/canceling a pointer before the next frame must retain its last
    // physical position. Animated wheel/navigation targets are simply dropped.
    if (pending?.mode === "direct") this.env.render(pending.target, pending.edited, pending.mode);
  }

  /** Snapshot replacement and unmount discard all old-camera work. */
  cancel() {
    if (this.frame !== null) this.env.cancelFrame(this.frame);
    this.frame = null;
    this.motion = null;
  }

  private tick = (time: number) => {
    this.frame = null;
    const motion = this.motion;
    if (!motion) return;
    const ms = this.env.reducedMotion() ? 0 : duration[motion.mode];
    const progress = ms ? Math.min(1, Math.max(0, (time - motion.started) / ms)) : 1;
    const t = 1 - (1 - progress) ** 3;
    const next = progress === 1 ? motion.target : {
      x: motion.from.x + (motion.target.x - motion.from.x) * t,
      y: motion.from.y + (motion.target.y - motion.from.y) * t,
      zoom: motion.from.zoom + (motion.target.zoom - motion.from.zoom) * t,
    };
    if (progress === 1) this.motion = null;
    if (!same(this.env.read(), next)) this.env.render(next, motion.edited, motion.mode);
    if (this.motion && this.frame === null) this.frame = this.env.requestFrame(this.tick);
  };
}
