import { RefObject, useEffect } from "react";

export function useMessageAutoScroll({
  messageEndRef,
  messageCount,
  busy,
}: {
  messageEndRef: RefObject<HTMLDivElement | null>;
  messageCount: number;
  busy: boolean;
}) {
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messageEndRef, messageCount, busy]);
}
