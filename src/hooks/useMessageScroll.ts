import { useRef, useEffect, useCallback } from "react";

/**
 * Shared auto-scroll logic for chat message containers.
 * Handles auto-scroll to bottom on new messages, user scroll detection
 * (stops auto-scroll when user scrolls up), and touch/wheel event support.
 *
 * @param resetDeps - Dependencies that reset auto-scroll to true (e.g. conversation change)
 * @param scrollDeps - Dependencies that trigger auto-scroll when near bottom (e.g. new messages)
 */
export function useMessageScroll(
  resetDeps: readonly unknown[],
  scrollDeps: readonly unknown[],
) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const touchStartYRef = useRef<number | null>(null);

  const isNearBottom = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 150;
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, []);

  // Track scroll position — detect user scrolling up to disable auto-scroll
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    lastScrollTopRef.current = el.scrollTop;

    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < -2) {
        shouldAutoScrollRef.current = false;
      } else if (event.deltaY > 2 && isNearBottom()) {
        shouldAutoScrollRef.current = true;
      }
    };

    const onTouchStart = (event: TouchEvent) => {
      touchStartYRef.current = event.touches[0]?.clientY ?? null;
    };

    const onTouchMove = (event: TouchEvent) => {
      const currentY = event.touches[0]?.clientY;
      if (currentY == null || touchStartYRef.current == null) return;
      if (currentY > touchStartYRef.current + 4) {
        shouldAutoScrollRef.current = false;
      } else if (currentY < touchStartYRef.current - 4 && isNearBottom()) {
        shouldAutoScrollRef.current = true;
      }
    };

    const onScroll = () => {
      const currentScrollTop = el.scrollTop;
      const scrollingUp = currentScrollTop < lastScrollTopRef.current - 4;
      const nearBottom = isNearBottom();

      if (scrollingUp) {
        shouldAutoScrollRef.current = false;
      } else if (nearBottom) {
        shouldAutoScrollRef.current = true;
      }

      lastScrollTopRef.current = currentScrollTop;
    };

    const onTouchEnd = () => {
      touchStartYRef.current = null;
    };

    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("scroll", onScroll);
    };
  }, [isNearBottom]);

  // Reset auto-scroll on context change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    shouldAutoScrollRef.current = true;
    lastScrollTopRef.current = 0;
  }, resetDeps);

  // Auto-scroll on any relevant state change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      scrollToBottom();
    }
  }, scrollDeps);

  return {
    messagesEndRef,
    messagesContainerRef,
    scrollToBottom,
  };
}
