import { RefObject, useEffect } from "react";

export function useMessageAutoScroll({
  messageEndRef,
  messageCount,
  busy,
  activityKey = "",
}: {
  messageEndRef: RefObject<HTMLDivElement | null>;
  messageCount: number;
  busy: boolean;
  activityKey?: string;
}) {
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messageEndRef, messageCount, busy, activityKey]);
}
