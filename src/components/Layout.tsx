import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { useSettings } from '@/hooks/useData';
import { useAutoSync } from '@/hooks/useSync';
import { useKeyboardInsets } from '@/hooks/useKeyboardInsets';

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
  { to: '/nutrition', label: 'Food', icon: '🍽️' },
  { to: '/training', label: 'Train', icon: '🏋️' },
  { to: '/calendar', label: 'Calendar', icon: '📅' },
  { to: '/bloodwork', label: 'Bloodwork', icon: '🩸', secondary: true },
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

export function Layout() {
  useTheme();
  // Mounted once here so the whole app stays in step with the server.
  useAutoSync();
  // Keeps whatever field you are typing in clear of the keyboard and tab bar.
  useKeyboardInsets();
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
