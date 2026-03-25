import { useState, useCallback } from "react";

export function useClipboardFeedback(duration: number = 2000): {
  copied: boolean;
  copy: (text: string) => Promise<void>;
} {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), duration);
  }, [duration]);

  return { copied, copy };
}
