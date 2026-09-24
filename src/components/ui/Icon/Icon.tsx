import type { SVGProps } from "react";

export type IconName =
  | "today"
  | "calendar"
  | "inbox"
  | "clients"
  | "work"
  | "finance"
  | "analytics"
  | "assistant"
  | "settings"
  | "lock"
  | "chevronRight"
  | "arrowRight"
  | "arrowLeft"
  | "plus"
  | "close"
  | "more"
  | "receipt"
  | "sun"
  | "moon"
  | "monitor"
  | "globe"
  | "chevronDown"
  | "check"
  | "mail"
  | "phone"
  | "search"
  | "send"
  | "history";

const paths: Record<IconName, string> = {
  today:
    "M4 3h16M6 3v3M18 3v3M4 8h16M4 8v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8M9 13h6",
  calendar:
    "M4 5h16a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM3 10h18M8 3v4M16 3v4",
  inbox:
    "M3 12h4.5l1.5 3h6l1.5-3H21M4 12 5.6 5.4A1 1 0 0 1 6.57 4.6h10.86a1 1 0 0 1 .97.76L20 12v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6Z",
  clients:
    "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 20c.6-3.2 3-5 6-5s5.4 1.8 6 5M17 11a2.5 2.5 0 1 0 0-5M16.5 15c2.4.3 4 1.9 4.5 5",
  work:
    "M4 8h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1ZM8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18",
  finance:
    "M4 6h16v12H4zM4 10h16M8 14h1M12 14h4",
  analytics: "M4 20V10M10 20V4M16 20v-7M4 20h16",
  assistant:
    "M12 3.5 13.2 8l4.3 1.5-4.3 1.5L12 15.5 10.8 11 6.5 9.5l4.3-1.5ZM19 15l.6 1.8 1.9.6-1.9.6L19 20l-.6-1.8-1.9-.6 1.9-.6Z",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 13.5a1.7 1.7 0 0 0 .3 1.9l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2a1.9 1.9 0 1 1-3.9 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H4a1.9 1.9 0 1 1 0-3.9h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.7 1.7 0 0 0 1.9.3H10a1.7 1.7 0 0 0 1-1.5V4a1.9 1.9 0 1 1 3.9 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H20a1.9 1.9 0 1 1 0 3.9h-.1a1.7 1.7 0 0 0-1.5 1Z",
  lock: "M6 11V8a6 6 0 0 1 12 0v3M5 11h14v9H5zM12 15v2",
  chevronRight: "m9 5 7 7-7 7",
  /* A real directional arrow — shaft + head — not a chevron: the two
   * must never be visually interchangeable (§ root action rows need an
   * actual arrow-right glyph, not a bare chevron that reads as a
   * checkmark/tick at small sizes). */
  arrowRight: "M4 12h16M13 5l7 7-7 7",
  arrowLeft: "M20 12H4M11 5l-7 7 7 7",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6 6 18",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  receipt:
    "M6 3h12v18l-2.5-1.5L13 21l-1-1.5L11 21l-2.5-1.5L6 21V3ZM9 8h6M9 12h6M9 16h3",
  sun: "M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z",
  moon: "M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z",
  monitor: "M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM8 20h8M12 16v4",
  globe:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.2 2.3 3.3 5 3.3 9s-1.1 6.7-3.3 9c-2.2-2.3-3.3-5-3.3-9S9.8 5.3 12 3Z",
  chevronDown: "m6 9 6 6 6-6",
  check: "m5 12 5 5 9-9",
  mail: "M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1ZM3.5 7l8.5 6 8.5-6",
  phone:
    "M6.6 10.8a15.5 15.5 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.36 2.3.56 3.5.56a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.2 21 3 13.8 3 5a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.2.2 2.4.56 3.5a1 1 0 0 1-.25 1Z",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3",
  send: "m3 11 18-8-8 18-2.5-7.5L3 11Z",
  history: "M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3.5 2",
};

export function Icon({
  name,
  size = 20,
  strokeWidth = 1.6,
  ...props
}: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
