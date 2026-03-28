import { useState, useEffect } from "react";
import type { Attachment } from "../services/types";
import { readFileBase64 } from "../services/commands/chatCommands";

/**
 * Resolve an attachment's display URL.
 * Uses in-memory dataUrl if available, otherwise loads from disk via readFileBase64.
 */
export function useAttachmentSrc(att: Attachment): string | undefined {
  const [src, setSrc] = useState<string | undefined>(att.dataUrl);

  useEffect(() => {
    if (att.dataUrl) {
      setSrc(att.dataUrl);
      return;
    }
    if (!att.path) return;

    let cancelled = false;
    readFileBase64(att.path)
      .then((b64) => {
        if (!cancelled) {
          setSrc(`data:${att.mime || "image/png"};base64,${b64}`);
        }
      })
      .catch(() => {
        // File missing — leave src undefined
      });
    return () => { cancelled = true; };
  }, [att.path, att.dataUrl, att.mime]);

  return src;
}
