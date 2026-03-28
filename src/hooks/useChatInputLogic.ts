import { useState, useRef, useCallback, useEffect } from "react";
import { readImage } from "@tauri-apps/plugin-clipboard-manager";
import { useMessageStore, type PendingAttachment } from "../stores/messageStore";

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
  const addPendingAttachment = useMessageStore((s) => s.addPendingAttachment);

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

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      // First try web API (works in some cases)
      const items = e.clipboardData?.items;
      if (items) {
        for (const item of items) {
          if (item.type.startsWith("image/")) {
            e.preventDefault();
            const file = item.getAsFile();
            if (!file) continue;
            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = reader.result as string;
              const att: PendingAttachment = { type: "image", path: "", dataUrl };
              addPendingAttachment(att);
            };
            reader.readAsDataURL(file);
            return; // Handled via web API
          }
        }
      }
      // Fallback: Tauri native clipboard (works on Linux/WebKitGTK)
      readImage()
        .then(async (img) => {
          const [rgba, { width, height }] = await Promise.all([img.rgba(), img.size()]);
          if (!rgba || rgba.length === 0) return;
          // Convert RGBA bytes to PNG via canvas
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
          ctx.putImageData(imageData, 0, 0);
          const dataUrl = canvas.toDataURL("image/png");
          const att: PendingAttachment = { type: "image", path: "", dataUrl };
          addPendingAttachment(att);
        })
        .catch(() => {
          // No image in clipboard — let default paste (text) proceed
        });
    },
    [addPendingAttachment],
  );

  return {
    textareaRef,
    localValue,
    handleChange,
    handleKeyDown,
    handleCompositionStart,
    handleCompositionEnd,
    handlePaste,
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
      onPaste: handlePaste,
      disabled,
    },
  };
}
