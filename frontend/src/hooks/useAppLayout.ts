import { useCallback, useEffect, useRef, useState } from "react";

import { loadJSON, saveJSON } from "../utils";

export type MobileView = "explorer" | "files" | "chat" | "console";

const COMPACT_LAYOUT_MAX_WIDTH = 1100;

export function useAppLayout() {
  const [railOpen, setRailOpen] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= COMPACT_LAYOUT_MAX_WIDTH : false,
  );
  const [mobileView, setMobileView] = useState<MobileView>("chat");
  const [railWidth, setRailWidth] = useState(() => loadJSON<number>("cva.railWidth.v2", 268));
  const [panelWidth, setPanelWidth] = useState(() => loadJSON<number>("cva.panelWidth.v2", 380));
  const [fileViewerWidth, setFileViewerWidth] = useState(() =>
    loadJSON<number>("cva.fileViewerWidth.v1", 420),
  );
  const [isDragging, setIsDragging] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const startRailDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(180, Math.min(420, moveEvent.clientX - 56));
      setRailWidth(newWidth);
    };
    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  const startPanelDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      const startX = e.clientX;
      const startWidth = panelWidth;
      const handleMouseMove = (moveEvent: MouseEvent) => {
        const newWidth = Math.max(260, Math.min(600, startWidth + startX - moveEvent.clientX));
        setPanelWidth(newWidth);
      };
      const handleMouseUp = () => {
        setIsDragging(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [panelWidth],
  );

  const startFileViewerDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      const startX = e.clientX;
      const startWidth = fileViewerWidth;
      const handleMouseMove = (moveEvent: MouseEvent) => {
        const newWidth = Math.max(260, Math.min(900, startWidth + startX - moveEvent.clientX));
        setFileViewerWidth(newWidth);
      };
      const handleMouseUp = () => {
        setIsDragging(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [fileViewerWidth],
  );

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
    handleTouchStart,
    handleTouchEnd,
  };
}
