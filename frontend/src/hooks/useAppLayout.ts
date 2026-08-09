import { useCallback, useEffect, useRef, useState } from "react";

import { isNumberInRange, loadJSON, saveJSON } from "../utils/storage";
import { clampWidth, type ResizeBounds } from "../utils/panelResize.ts";

export type MobileView = "explorer" | "files" | "chat" | "console";

const COMPACT_LAYOUT_MAX_WIDTH = 1200;

export const RAIL_WIDTH_BOUNDS: ResizeBounds = { min: 180, max: 420 };
export const PANEL_WIDTH_BOUNDS: ResizeBounds = { min: 260, max: 600 };
export const FILE_VIEWER_WIDTH_BOUNDS: ResizeBounds = { min: 260, max: 900 };

const ACTIVITY_RAIL_WIDTH = 56;

export function useAppLayout() {
  const [railOpen, setRailOpen] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= COMPACT_LAYOUT_MAX_WIDTH : false,
  );
  const [mobileView, setMobileView] = useState<MobileView>("chat");
  const [railWidth, setRailWidth] = useState(() =>
    loadJSON(
      "cva.railWidth.v2",
      268,
      isNumberInRange(RAIL_WIDTH_BOUNDS.min, RAIL_WIDTH_BOUNDS.max),
    ),
  );
  const [panelWidth, setPanelWidth] = useState(() =>
    loadJSON(
      "cva.panelWidth.v2",
      380,
      isNumberInRange(PANEL_WIDTH_BOUNDS.min, PANEL_WIDTH_BOUNDS.max),
    ),
  );
  const [fileViewerWidth, setFileViewerWidth] = useState(() =>
    loadJSON(
      "cva.fileViewerWidth.v1",
      420,
      isNumberInRange(FILE_VIEWER_WIDTH_BOUNDS.min, FILE_VIEWER_WIDTH_BOUNDS.max),
    ),
  );
  const [isDragging, setIsDragging] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  const beginHorizontalDrag = useCallback(
    (event: React.MouseEvent, onMove: (clientX: number) => void) => {
      event.preventDefault();
      dragCleanupRef.current?.();
      setIsDragging(true);

      const cleanup = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        dragCleanupRef.current = null;
        setIsDragging(false);
      };
      const handleMouseMove = (moveEvent: MouseEvent) => onMove(moveEvent.clientX);
      const handleMouseUp = () => cleanup();

      dragCleanupRef.current = cleanup;
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [],
  );

  useEffect(
    () => () => {
      dragCleanupRef.current?.();
    },
    [],
  );

  const startRailDrag = useCallback(
    (event: React.MouseEvent) => {
      beginHorizontalDrag(event, (clientX) => {
        setRailWidth(clampWidth(clientX - ACTIVITY_RAIL_WIDTH, RAIL_WIDTH_BOUNDS));
      });
    },
    [beginHorizontalDrag],
  );

  const startPanelDrag = useCallback(
    (event: React.MouseEvent) => {
      const startX = event.clientX;
      const startWidth = panelWidth;
      beginHorizontalDrag(event, (clientX) => {
        setPanelWidth(clampWidth(startWidth + startX - clientX, PANEL_WIDTH_BOUNDS));
      });
    },
    [beginHorizontalDrag, panelWidth],
  );

  const startFileViewerDrag = useCallback(
    (event: React.MouseEvent) => {
      const startX = event.clientX;
      const startWidth = fileViewerWidth;
      beginHorizontalDrag(event, (clientX) => {
        setFileViewerWidth(clampWidth(startWidth + startX - clientX, FILE_VIEWER_WIDTH_BOUNDS));
      });
    },
    [beginHorizontalDrag, fileViewerWidth],
  );

  const resizeRail = useCallback((width: number) => {
    setRailWidth(clampWidth(width, RAIL_WIDTH_BOUNDS));
  }, []);

  const resizePanel = useCallback((width: number) => {
    setPanelWidth(clampWidth(width, PANEL_WIDTH_BOUNDS));
  }, []);

  const resizeFileViewer = useCallback((width: number) => {
    setFileViewerWidth(clampWidth(width, FILE_VIEWER_WIDTH_BOUNDS));
  }, []);

  useEffect(() => saveJSON("cva.railWidth.v2", railWidth), [railWidth]);
  useEffect(() => saveJSON("cva.panelWidth.v2", panelWidth), [panelWidth]);
  useEffect(() => saveJSON("cva.fileViewerWidth.v1", fileViewerWidth), [fileViewerWidth]);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= COMPACT_LAYOUT_MAX_WIDTH);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isMobile) return;
    const target = e.target as HTMLElement;
    if (
      target.tagName === "TEXTAREA" ||
      target.tagName === "INPUT" ||
      target.tagName === "SELECT" ||
      target.closest("pre") ||
      target.closest(".code-block-pre")
    ) {
      touchStartX.current = null;
      touchStartY.current = null;
      return;
    }
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!isMobile || touchStartX.current === null || touchStartY.current === null) return;

    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;

    const diffX = touchEndX - touchStartX.current;
    const diffY = touchEndY - touchStartY.current;

    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 60) {
      if (diffX > 0) {
        if (mobileView === "console") {
          setMobileView("chat");
        } else if (mobileView === "chat") {
          setMobileView("explorer");
        } else if (mobileView === "files") {
          setMobileView("explorer");
        }
      } else if (mobileView === "explorer" || mobileView === "files") {
        setMobileView("chat");
      } else if (mobileView === "chat") {
        setMobileView("console");
      }
    }

    touchStartX.current = null;
    touchStartY.current = null;
  };

  return {
    railOpen,
    setRailOpen,
    panelOpen,
    setPanelOpen,
    isMobile,
    mobileView,
    setMobileView,
    railWidth,
    panelWidth,
    fileViewerWidth,
    isDragging,
    startRailDrag,
    startPanelDrag,
    startFileViewerDrag,
    resizeRail,
    resizePanel,
    resizeFileViewer,
    handleTouchStart,
    handleTouchEnd,
  };
}
