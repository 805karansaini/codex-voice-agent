import { Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { SearchResult } from "../../types";
import { cn } from "../../utils";

type WorkspaceSearchBoxProps = {
  searchQuery: string;
  searchResults: SearchResult[];
  searching: boolean;
  searchError: string;
  onSearchQueryChange: (query: string) => void;
  onOpenSearchResult: (result: SearchResult) => void;
  mobile?: boolean;
  onDismiss?: () => void;
};

export default function WorkspaceSearchBox({
  searchQuery,
  searchResults,
  searching,
  searchError,
  onSearchQueryChange,
  onOpenSearchResult,
  mobile = false,
  onDismiss,
}: WorkspaceSearchBoxProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const open = searchQuery.trim().length >= 2;

  const dismiss = useCallback(() => {
    onSearchQueryChange("");
    onDismiss?.();
  }, [onDismiss, onSearchQueryChange]);

  useEffect(() => setActiveIndex(-1), [searchQuery, searchResults.length]);

  useEffect(() => {
    if (activeIndex < 0) return;
    resultRefs.current[activeIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeIndex]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) dismiss();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [dismiss]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
      return;
    }
    if (!open || searching || searchResults.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % searchResults.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? searchResults.length - 1 : current - 1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      onOpenSearchResult(searchResults[activeIndex]);
      onDismiss?.();
    }
  };

  return (
    <div ref={wrapperRef} className={cn("relative", mobile && "w-full")}>
      <div className="flex h-8 items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 text-[11.5px] text-fg-muted transition-colors focus-within:border-accent/60 focus-within:bg-surface-1">
        <Search className="h-3.5 w-3.5 shrink-0" />
        <input
          autoFocus={mobile}
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search chats"
          aria-label="Search chats"
          role="combobox"
          aria-expanded={open}
          aria-controls="workspace-search-results"
          aria-activedescendant={
            activeIndex >= 0 ? `workspace-search-result-${activeIndex}` : undefined
          }
          className={cn(
            "bg-transparent text-[12px] text-fg outline-none placeholder:text-fg-dim",
            mobile ? "w-full" : "w-52",
          )}
        />
        {mobile && (
          <button type="button" onClick={dismiss} aria-label="Close search">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div
          id="workspace-search-results"
          role="listbox"
          className={cn(
            "absolute top-9 z-30 overflow-hidden rounded-md border border-line bg-surface-1 shadow-xl",
            mobile ? "inset-x-0" : "right-0 w-80",
          )}
        >
          <div className="border-b border-line-soft px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-fg-dim">
            {searching
              ? "Searching"
              : searchError
                ? "Search unavailable"
                : `${searchResults.length} result${searchResults.length === 1 ? "" : "s"}`}
          </div>
          <div className="max-h-80 overflow-y-auto py-1">
            {searchError ? (
              <div role="alert" className="px-3 py-3 text-[12px] text-danger">
                {searchError}
              </div>
            ) : searching ? null : searchResults.length === 0 ? (
              <div className="px-3 py-3 text-[12px] text-fg-dim">No matches found.</div>
            ) : (
              searchResults.map((result, index) => (
                <button
                  type="button"
                  key={`${result.type}-${result.id}`}
                  ref={(node) => {
                    resultRefs.current[index] = node;
                  }}
                  id={`workspace-search-result-${index}`}
                  role="option"
                  aria-selected={activeIndex === index}
                  tabIndex={-1}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onOpenSearchResult(result);
                    onDismiss?.();
                  }}
                  className={cn(
                    "flex w-full flex-col gap-1 px-3 py-2 text-left hover:bg-surface-2",
                    activeIndex === index && "bg-surface-2",
                  )}
                >
                  <span className="flex items-center gap-2 text-[12px] font-semibold text-fg">
                    <span className="rounded border border-line-soft px-1.5 py-0.5 font-mono text-[9px] uppercase text-fg-dim">
                      {result.type}
                    </span>
                    {result.title || "Result"}
                  </span>
                  <span className="max-h-9 overflow-hidden text-[11.5px] leading-relaxed text-fg-muted">
                    {result.snippet || "No preview available."}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
