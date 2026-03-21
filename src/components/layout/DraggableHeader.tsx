import type { ReactNode } from "react";
import { useDragRegion } from "../../hooks/useDragRegion";

interface Props {
  className?: string;
  children: ReactNode;
}

/**
 * A header wrapper that enables window dragging on mouse down.
 * Interactive elements (buttons, inputs, selects, links) are
 * automatically excluded by useDragRegion.
 */
export default function DraggableHeader({ className, children }: Props) {
  const onDrag = useDragRegion();
  return (
    <div className={className} onMouseDown={onDrag}>
      {children}
    </div>
  );
}
