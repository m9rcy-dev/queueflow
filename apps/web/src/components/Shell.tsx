"use client";

import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type SVGProps,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CloseIcon, MenuIcon } from "./icons";
import { PoweredByQueueFlow } from "./QueueFlowLogo";

/* eslint-disable @next/next/no-img-element -- next/image's optimizer route is blocked (Phase 12); see BusinessLogo. */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001";

export interface ShellNavItem {
  href: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Also highlighted for pages under this path (e.g. a queue's dashboard under Queues). */
  matchPrefix?: boolean;
}

export interface ShellMenuItem {
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  href?: string;
  onSelect?: () => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

/**
 * The app shell (Phase 17), after budget-terry's AppShell: a left sidebar
 * on desktop that becomes a hamburger-opened drawer on narrow screens —
 * one menu and one profile footer in both, never two copies to keep in
 * sync. The profile footer opens a small menu (Account, log out, …), so
 * per-person things live under the person rather than in the main menu.
 * Used by both the business area and the customer area.
 */
export function Shell({
  brand,
  brandLogoPath = null,
  navItems,
  profileName,
  profileDetail,
  profileMenu,
  title,
  actions,
  children,
}: {
  brand: string;
  /** Phase 19: the business's logo (API path) beside its name; QueueFlow's own sits at the bottom. */
  brandLogoPath?: string | null;
  navItems: ShellNavItem[];
  profileName: string;
  profileDetail: string;
  profileMenu: ShellMenuItem[];
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDrawerOpen(false);
    setMenuOpen(false);
  }, [pathname]);

  // Close the profile menu on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const isActive = (item: ShellNavItem) =>
    pathname === item.href || (item.matchPrefix === true && pathname.startsWith(`${item.href}/`));

  return (
    <div className="flex min-h-screen bg-bg">
      {drawerOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-30 bg-text-primary/40 md:hidden"
        />
      )}

      <aside
        id="app-sidebar"
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-surface p-4 transition-transform duration-200 md:sticky md:top-0 md:z-auto md:h-screen md:translate-x-0 ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-6 flex items-center justify-between gap-2 px-1">
          <span className="flex min-w-0 items-center gap-2">
            {brandLogoPath && (
              <img
                src={`${API_URL}${brandLogoPath}`}
                alt=""
                className="h-8 max-w-[5rem] shrink-0 object-contain"
              />
            )}
            <span className="truncate text-base font-semibold text-text-primary">{brand}</span>
          </span>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
            className="text-text-secondary hover:text-text-primary md:hidden"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5">
          {navItems.map((item) => {
            const active = isActive(item);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium ${
                  active
                    ? "bg-primary/10 font-semibold text-primary"
                    : "text-text-secondary hover:bg-bg hover:text-text-primary"
                }`}
              >
                <item.Icon className="h-[18px] w-[18px] shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div ref={menuRef} className="relative mt-2 border-t border-border pt-3">
          {menuOpen && (
            <div
              role="menu"
              className="absolute bottom-full left-0 right-0 mb-2 flex flex-col rounded-lg border border-border bg-surface p-1 shadow-lg"
            >
              {profileMenu.map((item) => {
                const content = (
                  <>
                    <item.Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </>
                );
                const className =
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-text-primary hover:bg-bg";
                return item.href ? (
                  <Link key={item.label} href={item.href} role="menuitem" className={className}>
                    {content}
                  </Link>
                ) : (
                  <button
                    key={item.label}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      item.onSelect?.();
                    }}
                    className={className}
                  >
                    {content}
                  </button>
                );
              })}
            </div>
          )}
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="flex w-full items-center gap-2.5 rounded-lg p-1 text-left hover:bg-bg"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
              {initials(profileName)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-text-primary">
                {profileName}
              </span>
              <span className="block truncate text-xs text-text-secondary">{profileDetail}</span>
            </span>
          </button>
          <div className="mt-3 flex justify-center">
            <PoweredByQueueFlow />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 md:hidden">
          <button
            type="button"
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            aria-controls="app-sidebar"
            onClick={() => setDrawerOpen(true)}
            className="text-text-primary"
          >
            <MenuIcon className="h-5 w-5" />
          </button>
          <span className="flex min-w-0 items-center gap-2 px-3">
            {brandLogoPath && (
              <img
                src={`${API_URL}${brandLogoPath}`}
                alt=""
                className="h-6 max-w-[4rem] shrink-0 object-contain"
              />
            )}
            <span className="truncate text-sm font-semibold text-text-primary">{brand}</span>
          </span>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
            {initials(profileName)}
          </span>
        </div>

        <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-xl font-semibold text-text-primary">{title}</h1>
            {actions}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
