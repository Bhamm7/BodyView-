import { useEffect } from 'react';

/**
 * Keeps the focused field visible, and tells CSS when the keyboard is up.
 *
 * Two things obscure an input at the bottom of the screen: the on-screen
 * keyboard, and this app's own fixed tab bar. On iOS the keyboard resizes the
 * *visual* viewport rather than the layout viewport, so a `position: fixed`
 * element stays pinned where the keyboard now is — and Safari's own
 * scroll-into-view ends up fighting it, which is what makes the page lurch.
 *
 * So: measure the obstruction, scroll the field clear of it, and mark the
 * document so the tab bar can get out of the way entirely while typing.
 */

/** Below this, a visual-viewport change is browser chrome, not a keyboard. */
const KEYBOARD_THRESHOLD_PX = 120;
/** Breathing room between the field and whatever is covering it. */
const MARGIN_PX = 20;

function isField(node: unknown): node is HTMLElement {
  return (
    node instanceof HTMLElement &&
    (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT')
  );
}

export function useKeyboardInsets(): void {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let frame = 0;

    /** How much of the bottom of the screen the keyboard is covering. */
    const keyboardInset = (): number => {
      if (!viewport) return 0;
      return Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    };

    /**
     * The lowest y a field can sit at and still be fully visible. With the
     * keyboard up the tab bar is hidden, so only one of the two ever applies.
     */
    const obstructionBottom = (): number => {
      const keyboard = keyboardInset();
      if (keyboard > KEYBOARD_THRESHOLD_PX) return keyboard;
      const tabbar = document.querySelector('.tabbar');
      if (!tabbar) return 0;
      const style = getComputedStyle(tabbar);
      return style.display === 'none' ? 0 : tabbar.getBoundingClientRect().height;
    };

    const reveal = () => {
      const el = document.activeElement;
      if (!isField(el)) return;

      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        const top = viewport?.offsetTop ?? 0;
        const visibleBottom = top + (viewport?.height ?? window.innerHeight) - obstructionBottom();

        // Only move when the field is genuinely covered — nudging a field that
        // is already visible is its own kind of jumpiness.
        const below = rect.bottom - (visibleBottom - MARGIN_PX);
        const above = top + MARGIN_PX - rect.top;

        if (below > 1) window.scrollBy({ top: below, behavior: 'smooth' });
        else if (above > 1) window.scrollBy({ top: -above, behavior: 'smooth' });
      });
    };

    const sync = () => {
      const keyboard = keyboardInset();
      const open = keyboard > KEYBOARD_THRESHOLD_PX;
      root.style.setProperty('--keyboard-inset', `${open ? keyboard : 0}px`);
      if (open) root.setAttribute('data-keyboard-open', '');
      else root.removeAttribute('data-keyboard-open');
      if (open) reveal();
    };

    // The keyboard animates in, so the geometry right after focus is not the
    // geometry that matters; re-check once it has settled.
    const onFocusIn = (event: FocusEvent) => {
      if (!isField(event.target)) return;
      reveal();
      window.setTimeout(reveal, 150);
      window.setTimeout(reveal, 400);
    };

    const onFocusOut = () => {
      window.setTimeout(sync, 150);
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    viewport?.addEventListener('resize', sync);
    viewport?.addEventListener('scroll', sync);
    window.addEventListener('orientationchange', sync);

    sync();

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      viewport?.removeEventListener('resize', sync);
      viewport?.removeEventListener('scroll', sync);
      window.removeEventListener('orientationchange', sync);
      root.removeAttribute('data-keyboard-open');
      root.style.removeProperty('--keyboard-inset');
    };
  }, []);
}
