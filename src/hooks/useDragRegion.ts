import { useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const INTERACTIVE = new Set(["BUTTON", "A", "INPUT", "TEXTAREA", "SELECT"]);

export function useDragRegion() {
  return useCallback((e: React.MouseEvent) => {
    // Don't drag when clicking interactive elements
    let el = e.target as HTMLElement | null;
    while (el && el !== e.currentTarget) {
      if (INTERACTIVE.has(el.tagName) || el.closest("[data-no-drag]")) return;
      el = el.parentElement;
    }
    if (e.button === 0) {
      getCurrentWindow().startDragging();
    }
  }, []);
}
