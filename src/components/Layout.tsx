import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { useSettings } from '@/hooks/useData';
import { useAutoSync } from '@/hooks/useSync';
import { useUpdateAvailable } from '@/hooks/useUpdateAvailable';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  /** Hidden from the phone tab bar; still reachable from the sidebar. */
  secondary?: boolean;
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Today', icon: '🏠' },
  { to: '/health', label: 'Health', icon: '❤️' },
  { to: '/cycles', label: 'Cycles', icon: '💊' },
  { to: '/bloodwork', label: 'Blood', icon: '🩸' },
  { to: '/nutrition', label: 'Food', icon: '🍽️' },
  { to: '/training', label: 'Train', icon: '🏋️' },
  { to: '/calendar', label: 'Calendar', icon: '📅' },
  { to: '/inventory', label: 'Stock', icon: '📦', secondary: true },
  { to: '/settings', label: 'Settings', icon: '⚙️', secondary: true },
];

/** Applies the user's theme choice to the document root. */
function useTheme() {
  const [settings] = useSettings();
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);
}

/**
 * iOS does not let a fixed element sit under the keyboard: it rides up with
 * the keyboard tray and lands on top of the field being typed into. Hiding the
 * tab bar while anything has focus gives the keyboard the bottom of the screen,
 * which is what it wants anyway.
 */
function useKeyboardAwareChrome() {
  useEffect(() => {
    const isField = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable);

    const onFocusIn = (e: FocusEvent) => {
      if (isField(e.target)) document.body.classList.add('keyboard-open');
    };
    const onFocusOut = (e: FocusEvent) => {
      if (isField(e.target)) document.body.classList.remove('keyboard-open');
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.body.classList.remove('keyboard-open');
    };
  }, []);
}

/**
 * Publishes the visual viewport as CSS variables.
 *
 * A `position: fixed` element is laid out against the *layout* viewport, which
 * iOS does not shrink when the keyboard appears — so a sheet pinned to the
 * bottom ends up behind the keyboard, or below the screen entirely, which is
 * exactly what a search field with autofocus produces. The visual viewport is
 * the part actually on screen, so sheets are sized and positioned against it
 * instead.
 *
 * Browsers without the API (and desktop, where none of this bites) keep the
 * fallbacks in the stylesheet.
 */
function useVisualViewportVars() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const apply = () => {
      const root = document.documentElement;
      // How much of the layout viewport is hidden below the visible area:
      // the keyboard, essentially.
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty('--vv-height', `${Math.round(vv.height)}px`);
      root.style.setProperty('--vv-bottom-inset', `${Math.round(inset)}px`);
    };

    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      const root = document.documentElement;
      root.style.removeProperty('--vv-height');
      root.style.removeProperty('--vv-bottom-inset');
    };
  }, []);
}

export function Layout() {
  useTheme();
  useKeyboardAwareChrome();
  useVisualViewportVars();
  // Mounted once here so the whole app stays in step with the server.
  useAutoSync();
  const update = useUpdateAvailable();
  const { pathname } = useLocation();

  // A fresh route should start at the top, not wherever the last one was.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Sections">
        <div className="brand">
          <img src="icons/icon-192.png" alt="" width={30} height={30} />
          BodyView
        </div>
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'}>
            <span className="tab-icon" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="shell-body">
        {update.available && (
          <div className="update-banner" role="status">
            <span className="grow">A newer version is on the server.</span>
            <button className="btn primary sm" onClick={update.reload}>
              Reload
            </button>
          </div>
        )}
        <Outlet />
      </div>

      <nav className="tabbar" aria-label="Sections">
        {NAV.filter((i) => !i.secondary).map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'}>
            <span className="tab-icon" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

/** Standard page frame: sticky header plus a scrolling body. */
export function Page({
  title,
  actions,
  children,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <header className="app-header">
        <h1>{title}</h1>
        {actions && <div className="header-actions">{actions}</div>}
      </header>
      <main className="app-main">{children}</main>
    </>
  );
}
