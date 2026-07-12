import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

const FOLLOW_THRESHOLD_PX = 96;

export function isNearScrollBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold = FOLLOW_THRESHOLD_PX,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

type ScrollListenerTarget = Pick<HTMLElement, "addEventListener" | "removeEventListener">;

export function reconcileScrollListener(
  previous: ScrollListenerTarget | null,
  next: ScrollListenerTarget | null,
  listener: EventListener,
  onAttach?: () => void,
): ScrollListenerTarget | null {
  if (previous === next) return next;
  previous?.removeEventListener("scroll", listener);
  next?.addEventListener("scroll", listener, { passive: true });
  if (next) onAttach?.();
  return next;
}

export function useMessageAutoScroll({
  scrollContainerRef,
  messageEndRef,
  contentKey,
  conversationKey,
}: {
  scrollContainerRef: RefObject<HTMLElement | null>;
  messageEndRef: RefObject<HTMLDivElement | null>;
  contentKey: unknown;
  conversationKey: string;
}) {
  const followingRef = useRef(true);
  const attachedContainerRef = useRef<HTMLElement | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const updateFollowState = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const nearBottom = isNearScrollBottom(
      container.scrollHeight,
      container.scrollTop,
      container.clientHeight,
    );
    followingRef.current = nearBottom;
    setShowJumpToLatest(!nearBottom);
  }, [scrollContainerRef]);

  // The mobile layout unmounts the chat section when another view opens. Reconcile
  // the listener after every render so a newly mounted section is observed too.
  useEffect(() => {
    const previous = attachedContainerRef.current;
    const next = scrollContainerRef.current;
    attachedContainerRef.current = reconcileScrollListener(
      previous,
      next,
      updateFollowState,
      () => {
        if (followingRef.current) {
          messageEndRef.current?.scrollIntoView({ behavior: "auto" });
        } else {
          setShowJumpToLatest(true);
        }
      },
    ) as HTMLElement | null;
  });

  useEffect(
    () => () => {
      attachedContainerRef.current = reconcileScrollListener(
        attachedContainerRef.current,
        null,
        updateFollowState,
      ) as HTMLElement | null;
    },
    [updateFollowState],
  );

  useEffect(() => {
    followingRef.current = true;
    setShowJumpToLatest(false);
    messageEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, [conversationKey, messageEndRef]);

  useEffect(() => {
    if (followingRef.current) {
      messageEndRef.current?.scrollIntoView({ behavior: "auto" });
      return;
    }
    setShowJumpToLatest(true);
  }, [contentKey, messageEndRef]);

  const jumpToLatest = useCallback(() => {
    followingRef.current = true;
    setShowJumpToLatest(false);
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messageEndRef]);

  return { showJumpToLatest, jumpToLatest };
}
