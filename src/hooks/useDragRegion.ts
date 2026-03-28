import { useCallback, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const INTERACTIVE = new Set(["BUTTON", "A", "INPUT", "TEXTAREA", "SELECT"]);
const DOUBLE_CLICK_MS = 500;

function isInteractive(e: React.MouseEvent) {
  let el = e.target as HTMLElement | null;
  while (el && el !== e.currentTarget) {
    if (INTERACTIVE.has(el.tagName) || el.closest("[data-no-drag]")) return true;
    el = el.parentElement;
  }
  return false;
}

export function useDragRegion() {
  const lastClickRef = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (isInteractive(e) || e.button !== 0) return;

    const now = Date.now();
    if (now - lastClickRef.current < DOUBLE_CLICK_MS) {
      lastClickRef.current = 0;
      getCurrentWindow().toggleMaximize();
    } else {
      lastClickRef.current = now;
      getCurrentWindow().startDragging();
    }
  }, []);

  // Keep onDoubleClick as no-op fallback for components that already bind it
  const onDoubleClick = useCallback(() => {}, []);

  return { onMouseDown, onDoubleClick };
}
