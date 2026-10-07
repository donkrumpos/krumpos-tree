// Motion helpers: every animation is rAF-driven, returns a function that
// cancels it by jumping to its end state, and runs instantly when the viewer
// prefers reduced motion.

export const reducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  !!window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

/**
 * Run `frame(t)` with t eased from 0 to 1 over `duration` ms. Returns a
 * finisher that cancels the loop and lands on t = 1 (idempotent).
 */
export function tween(
  duration: number,
  frame: (t: number) => void,
  opts: { instant?: boolean; ease?: (t: number) => number; done?: () => void } = {},
): () => void {
  const ease = opts.ease || easeOutCubic;
  let finished = false;
  let raf = 0;
  const finish = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    frame(1);
    opts.done?.();
  };
  if (opts.instant || duration <= 0) {
    finish();
    return finish;
  }
  const start = performance.now();
  const step = (now: number) => {
    if (finished) return;
    const t = Math.min(1, (now - start) / duration);
    if (t >= 1) return finish();
    frame(ease(t));
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return finish;
}

/**
 * A staggered reveal: group i starts `stagger * i` ms in and takes `duration`
 * ms. `frame` gets each group's eased progress (0..1). Skippable via the
 * returned finisher, which lands every group on 1.
 */
export function stagger(
  groups: number,
  opts: { stagger: number; duration: number; instant?: boolean },
  frame: (progress: number[]) => void,
  done?: () => void,
): () => void {
  const total = opts.stagger * Math.max(0, groups - 1) + opts.duration;
  return tween(
    total,
    (t) => {
      const ms = t * total;
      const p: number[] = [];
      for (let i = 0; i < groups; i++) {
        p.push(easeOutCubic(Math.max(0, Math.min(1, (ms - i * opts.stagger) / opts.duration))));
      }
      frame(p);
    },
    { instant: opts.instant, ease: (t) => t, done },
  );
}
