import { useEffect, useRef, useId, type ReactNode } from "react";
import { X } from "lucide-react";

interface ModalProps {
  children: ReactNode;
  onClose: () => void;
  title: ReactNode;
  /** How clicking the backdrop behaves. Default: "none" */
  overlayClose?: "stopPropagation" | "currentTarget" | "none";
  /** Extra className on .modal-content */
  contentClassName?: string;
  /** Footer slot (rendered after children, inside modal-content) */
  footer?: ReactNode;
  /** Error message rendered above footer */
  error?: string | null;
}

export default function Modal({
  children,
  onClose,
  title,
  overlayClose = "none",
  contentClassName,
  footer,
  error,
}: ModalProps) {
  const handleOverlayClick =
    overlayClose === "none"
      ? undefined
      : overlayClose === "currentTarget"
        ? (e: React.MouseEvent) => {
            if (e.target === e.currentTarget) onClose();
          }
        : onClose; // "stopPropagation" — onClose on overlay, stopPropagation on content

  const handleContentClick =
    overlayClose === "stopPropagation"
      ? (e: React.MouseEvent) => e.stopPropagation()
      : undefined;

  const titleId = useId();
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const focusable = el.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Tab") {
        const el = contentRef.current;
        if (!el) return;
        const focusableEls = el.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusableEls.length === 0) return;
        const first = focusableEls[0];
        const last = focusableEls[focusableEls.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`modal-content${contentClassName ? ` ${contentClassName}` : ""}`}
        onClick={handleContentClick}
      >
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button className="close-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {children}

        {error && <div className="modal-error">{error}</div>}

        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
