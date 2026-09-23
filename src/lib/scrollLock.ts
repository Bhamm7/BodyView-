/**
 * Page scroll lock, counted rather than saved and restored.
 *
 * Sheets nest — the exercise picker opens the new-exercise editor on top of
 * itself — and two components that each remember "what overflow was before me"
 * do not compose: the inner one captures the outer one's `hidden` and puts it
 * back when it closes. Every sheet then closes and the page is left locked,
 * with nothing on screen to explain why, which reads as the whole app having
 * frozen.
 *
 * A counter has no such trouble: the first lock captures the real value, the
 * last release restores it, and releasing twice is harmless — unmount order is
 * not something a caller should have to reason about.
 */
export interface ScrollTarget {
  style: { overflow: string };
}

let locks = 0;
let overflowBeforeLock = '';

export function lockScroll(target: ScrollTarget): () => void {
  if (locks === 0) {
    overflowBeforeLock = target.style.overflow;
    target.style.overflow = 'hidden';
  }
  locks += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks = Math.max(0, locks - 1);
    if (locks === 0) target.style.overflow = overflowBeforeLock;
  };
}

/** Test seam: forgets any outstanding locks. */
export function resetScrollLocks(): void {
  locks = 0;
  overflowBeforeLock = '';
}
