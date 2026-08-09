import type { KeyboardEvent, MouseEvent } from "react";

import {
  nextResizeWidth,
  type ResizeBounds,
  type ResizeDirection,
} from "../../utils/panelResize.ts";

type PanelResizerProps = {
  label: string;
  width: number;
  bounds: ResizeBounds;
  direction: ResizeDirection;
  onDragStart: (event: MouseEvent) => void;
  onResize: (width: number) => void;
};

/**
 * The draggable divider between two panels. It is focusable so the layout can
 * be resized with the keyboard, which pointer-only drag handles do not allow.
 */
export default function PanelResizer({
  label,
  width,
  bounds,
  direction,
  onDragStart,
  onResize,
}: PanelResizerProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = nextResizeWidth(width, event.key, direction, bounds, event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    onResize(next);
  };

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={Math.round(width)}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      tabIndex={0}
      className="w-2 shrink-0 cursor-col-resize bg-line-soft transition-colors hover:bg-accent/40 focus-visible:bg-accent/60 active:bg-accent"
      onMouseDown={onDragStart}
      onKeyDown={handleKeyDown}
    />
  );
}
