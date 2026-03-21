import type { ReactNode } from "react";
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

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div
        className={`modal-content${contentClassName ? ` ${contentClassName}` : ""}`}
        onClick={handleContentClick}
      >
        <div className="modal-header">
          <h2>{title}</h2>
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
