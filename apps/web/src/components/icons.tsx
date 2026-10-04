import type { SVGProps } from "react";

/**
 * Small hand-built icon set for the app shell's menu (Phase 17) — the same
 * approach as budget-terry's: plain SVG primitives, no icon library,
 * `currentColor` so each icon takes its menu item's text colour.
 */
type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function QueueIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="5" cy="6" r="2" />
      <circle cx="10" cy="6" r="2" />
      <circle cx="15" cy="6" r="2" />
      <path d="M2.5 15c0-1.7 1.1-3 2.5-3s2.5 1.3 2.5 3M7.5 15c0-1.7 1.1-3 2.5-3s2.5 1.3 2.5 3M12.5 15c0-1.7 1.1-3 2.5-3s2.5 1.3 2.5 3" />
    </svg>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="4.5" width="14" height="12.5" rx="2" />
      <line x1="3" y1="8.5" x2="17" y2="8.5" />
      <line x1="7" y1="2.5" x2="7" y2="6" />
      <line x1="13" y1="2.5" x2="13" y2="6" />
    </svg>
  );
}

export function QrIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="3" width="5" height="5" rx="1" />
      <rect x="12" y="3" width="5" height="5" rx="1" />
      <rect x="3" y="12" width="5" height="5" rx="1" />
      <path d="M12 12h2v2h-2zM15.5 12H17M12 15.5V17M15 15h2v2h-2z" />
    </svg>
  );
}

export function LocationIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 17.5s5.5-4.8 5.5-9a5.5 5.5 0 1 0-11 0c0 4.2 5.5 9 5.5 9z" />
      <circle cx="10" cy="8.5" r="2" />
    </svg>
  );
}

export function StaffIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="7.5" cy="7" r="2.5" />
      <path d="M2.5 16c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5" />
      <circle cx="14" cy="7.5" r="2" />
      <path d="M13.5 11.6c2.2.2 4 1.9 4 4.4" />
    </svg>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" />
    </svg>
  );
}

export function TicketIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 6.5a1.5 1.5 0 0 0 0 3v4a1.5 1.5 0 0 1 1.5 1.5h11A1.5 1.5 0 0 1 17 13.5v-4a1.5 1.5 0 0 0 0-3V5H3z" />
      <line x1="8" y1="5" x2="8" y2="15" strokeDasharray="1.5 1.5" />
    </svg>
  );
}

export function AccountIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="7" r="3" />
      <path d="M4 17c0-3 2.7-5 6-5s6 2 6 5" />
    </svg>
  );
}

export function KeyIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="7" cy="10" r="3" />
      <path d="M10 10h7.5M15 10v2.5M13 10v2" />
    </svg>
  );
}

export function LogoutIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M8 3.5H5a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 5 16.5h3" />
      <path d="M12.5 13.5L16 10l-3.5-3.5M16 10H8" />
    </svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <line x1="3" y1="5.5" x2="17" y2="5.5" />
      <line x1="3" y1="10" x2="17" y2="10" />
      <line x1="3" y1="14.5" x2="17" y2="14.5" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <line x1="5" y1="5" x2="15" y2="15" />
      <line x1="15" y1="5" x2="5" y2="15" />
    </svg>
  );
}
