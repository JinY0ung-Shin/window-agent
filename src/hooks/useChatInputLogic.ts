import { useState, useRef, useCallback, useEffect } from "react";
import { useMessageStore } from "../stores/messageStore";

interface UseChatInputLogicOptions {
  /** Function to call when user sends a message (after flushing local value to store) */
  sendFn: () => void;
  /** Whether the textarea should be disabled */
  disabled?: boolean;
}

/**
 * Shared chat input logic for both solo and team chat inputs.
 * Handles Korean IME composition, textarea auto-resize, keyboard shortcuts,
 * and local value buffering to prevent React re-renders during composition.
 */
export function useChatInputLogic({ sendFn, disabled = false }: UseChatInputLogicOptions) {
  const inputValue = useMessageStore((s) => s.inputValue);
  const setInputValue = useMessageStore((s) => s.setInputValue);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposing = useRef(false);

  // Local buffer so the textarea always reflects the latest value including
  // intermediate IME composition states. The Zustand store is only updated
  // when NOT composing (or on compositionEnd) to prevent React re-renders
  // from resetting the textarea value mid-composition.
  const [localValue, setLocalValue] = useState(inputValue);

  // Sync store → local when the store changes externally
  // (e.g. input cleared after sending a message)
  useEffect(() => {
    if (!isComposing.current) {
      setLocalValue(inputValue);
    }
  }, [inputValue]);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [localValue, adjustHeight]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      setLocalValue(val);
      if (!isComposing.current) {
        setInputValue(val);
      }
    },
    [setInputValue],
  );

  const handleCompositionStart = useCallback(() => {
    isComposing.current = true;
  }, []);

  const handleCompositionEnd = useCallback(
    (e: React.CompositionEvent<HTMLTextAreaElement>) => {
      isComposing.current = false;
      const val = (e.target as HTMLTextAreaElement).value;
      setLocalValue(val);
      setInputValue(val);
    },
    [setInputValue],
  );

  // Flush localValue to the store before delegating to sendFn,
  // so the store always has the latest text even if composition just ended.
  const flushAndSend = useCallback(() => {
    setInputValue(localValue);
    sendFn();
  }, [localValue, setInputValue, sendFn]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !isComposing.current) {
        e.preventDefault();
        flushAndSend();
      }
    },
    [flushAndSend],
  );

  return {
    textareaRef,
    localValue,
    handleChange,
    handleKeyDown,
    handleCompositionStart,
    handleCompositionEnd,
    flushAndSend,
    /** Props to spread onto <textarea> */
    textareaProps: {
      ref: textareaRef,
      value: localValue,
      rows: 1 as const,
      onChange: handleChange,
      onKeyDown: handleKeyDown,
      onCompositionStart: handleCompositionStart,
      onCompositionEnd: handleCompositionEnd,
      disabled,
    },
  };
}
