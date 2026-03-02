import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export type AppIconName =
  | "dashboard"
  | "chat"
  | "users"
  | "tasks"
  | "reports"
  | "orgchart"
  | "settings"
  | "building"
  | "bell"
  | "user"
  | "bot"
  | "spark"
  | "plus"
  | "send"
  | "clock"
  | "calendar"
  | "folder"
  | "shield"
  | "monitor"
  | "trendUp"
  | "trendDown"
  | "money"
  | "empty"
  | "close"
  | "menu"
  | "edit"
  | "trash"
  | "filter"
  | "search"
  | "command";

interface AppIconProps {
  name: AppIconName;
  className?: string;
  size?: number;
  strokeWidth?: number;
}

export function AppIcon({
  name,
  className,
  size = 18,
  strokeWidth = 1.8,
}: AppIconProps) {
  const commonProps = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth,
  };

  let content: ReactNode;

  switch (name) {
    case "dashboard":
      content = (
        <>
          <path {...commonProps} d="M3 13h8V3H3zM13 21h8v-6h-8zM13 11h8V3h-8zM3 21h8v-6H3z" />
        </>
      );
      break;
    case "chat":
      content = (
        <>
          <path {...commonProps} d="M21 12a8 8 0 0 1-8 8H7l-4 3v-7a8 8 0 1 1 18-4Z" />
        </>
      );
      break;
    case "users":
      content = (
        <>
          <path {...commonProps} d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle {...commonProps} cx="8.5" cy="7" r="3.5" />
          <path {...commonProps} d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path {...commonProps} d="M16.5 3.1a3.5 3.5 0 1 1 0 6.8" />
        </>
      );
      break;
    case "tasks":
      content = (
        <>
          <rect {...commonProps} x="4" y="3" width="16" height="18" rx="2" />
          <path {...commonProps} d="M9 8h7M9 12h7M9 16h5M6.5 8h.01M6.5 12h.01M6.5 16h.01" />
        </>
      );
      break;
    case "reports":
      content = (
        <>
          <path {...commonProps} d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path {...commonProps} d="M14 2v6h6" />
          <path {...commonProps} d="M8 13h8M8 17h6" />
        </>
      );
      break;
    case "orgchart":
      content = (
        <>
          <rect {...commonProps} x="10" y="3" width="4" height="4" rx="1" />
          <rect {...commonProps} x="3" y="17" width="4" height="4" rx="1" />
          <rect {...commonProps} x="10" y="17" width="4" height="4" rx="1" />
          <rect {...commonProps} x="17" y="17" width="4" height="4" rx="1" />
          <path {...commonProps} d="M12 7v4M5 17v-2h14v2" />
        </>
      );
      break;
    case "settings":
      content = (
        <>
          <circle {...commonProps} cx="12" cy="12" r="3" />
          <path
            {...commonProps}
            d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 1 1-4 0v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a2 2 0 1 1 0-4h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2H9a1 1 0 0 0 .6-.9V4a2 2 0 1 1 4 0v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1 1 0 0 0-.2 1.1v.1a1 1 0 0 0 .9.6h.2a2 2 0 1 1 0 4h-.2a1 1 0 0 0-.9.6z"
          />
        </>
      );
      break;
    case "building":
      content = (
        <>
          <path {...commonProps} d="M4 22h16" />
          <path {...commonProps} d="M6 22V6l6-3 6 3v16" />
          <path {...commonProps} d="M9 9h1M14 9h1M9 13h1M14 13h1M11 22v-4h2v4" />
        </>
      );
      break;
    case "bell":
      content = (
        <>
          <path {...commonProps} d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 0 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
          <path {...commonProps} d="M10 21a2 2 0 0 0 4 0" />
        </>
      );
      break;
    case "user":
      content = (
        <>
          <circle {...commonProps} cx="12" cy="8" r="4" />
          <path {...commonProps} d="M4 21a8 8 0 0 1 16 0" />
        </>
      );
      break;
    case "bot":
      content = (
        <>
          <rect {...commonProps} x="4" y="7" width="16" height="12" rx="2" />
          <path {...commonProps} d="M12 3v4M8 12h.01M16 12h.01M9 16h6" />
        </>
      );
      break;
    case "spark":
      content = (
        <>
          <path {...commonProps} d="m12 3 1.8 4.5L18 9.3l-4.2 1.8L12 16l-1.8-4.9L6 9.3l4.2-1.8z" />
          <path {...commonProps} d="m5 3 .9 2.1L8 6l-2.1.9L5 9l-.9-2.1L2 6l2.1-.9z" />
          <path {...commonProps} d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" />
        </>
      );
      break;
    case "plus":
      content = <path {...commonProps} d="M12 5v14M5 12h14" />;
      break;
    case "send":
      content = <path {...commonProps} d="m22 2-7 20-4-9-9-4zM22 2 11 13" />;
      break;
    case "clock":
      content = (
        <>
          <circle {...commonProps} cx="12" cy="12" r="9" />
          <path {...commonProps} d="M12 7v5l3 3" />
        </>
      );
      break;
    case "calendar":
      content = (
        <>
          <rect {...commonProps} x="3" y="5" width="18" height="16" rx="2" />
          <path {...commonProps} d="M16 3v4M8 3v4M3 11h18" />
        </>
      );
      break;
    case "folder":
      content = (
        <>
          <path {...commonProps} d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" />
        </>
      );
      break;
    case "shield":
      content = (
        <>
          <path {...commonProps} d="m12 3 7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z" />
        </>
      );
      break;
    case "monitor":
      content = (
        <>
          <rect {...commonProps} x="3" y="4" width="18" height="13" rx="2" />
          <path {...commonProps} d="M8 21h8M12 17v4" />
        </>
      );
      break;
    case "trendUp":
      content = <path {...commonProps} d="M3 17h5l4-6 4 3 5-7M21 7v5h-5" />;
      break;
    case "trendDown":
      content = <path {...commonProps} d="M3 7h5l4 6 4-3 5 7M21 17v-5h-5" />;
      break;
    case "money":
      content = (
        <>
          <rect {...commonProps} x="3" y="6" width="18" height="12" rx="2" />
          <path {...commonProps} d="M12 10v4M10 12h4" />
        </>
      );
      break;
    case "empty":
      content = (
        <>
          <path {...commonProps} d="M3 8h18l-2 11H5z" />
          <path {...commonProps} d="M9 8V5a3 3 0 1 1 6 0v3" />
        </>
      );
      break;
    case "menu":
      content = <path {...commonProps} d="M4 6h16M4 12h16M4 18h16" />;
      break;
    case "close":
      content = <path {...commonProps} d="m6 6 12 12M6 18 18 6" />;
      break;
    case "edit":
      content = <path {...commonProps} d="M12 20h9M4 16.5V20h3.5L19 8.5 15.5 5z" />;
      break;
    case "trash":
      content = (
        <>
          <path {...commonProps} d="M3 6h18M8 6V4h8v2m-1 0v14a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V6" />
          <path {...commonProps} d="M10 11v6M14 11v6" />
        </>
      );
      break;
    case "filter":
      content = <path {...commonProps} d="M4 6h16l-6 7v5l-4-2v-3z" />;
      break;
    case "search":
      content = (
        <>
          <circle {...commonProps} cx="11" cy="11" r="7" />
          <path {...commonProps} d="m21 21-4.3-4.3" />
        </>
      );
      break;
    case "command":
      content = (
        <>
          <path {...commonProps} d="M8 7a3 3 0 1 0-3 3h14a3 3 0 1 0-3-3v10a3 3 0 1 0 3-3H5a3 3 0 1 0 3 3z" />
        </>
      );
      break;
    default:
      content = <circle {...commonProps} cx="12" cy="12" r="9" />;
  }

  return (
    <svg
      className={cn("shrink-0", className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      {content}
    </svg>
  );
}
