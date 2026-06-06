import React from "react";
import { BracketsCurly } from "@phosphor-icons/react";
import { Message } from "../../types";
import MarkdownRenderer from "../common/MarkdownRenderer";

interface ChatBubbleProps {
  message: Message;
  index: number;
}

export const ChatBubble: React.FC<ChatBubbleProps> = ({ message, index }) => {
  const isAssistant = message.role === "assistant";

  return (
    <article 
      className={`msg ${message.role}`} 
      style={{ ["--i" as string]: index % 12 }}
    >
      <div className="msgHead">
        <span className="who">{message.role === "user" ? "You" : "Agent"}</span>
        {message.usedCodex && (
          <span className="tag">
            <BracketsCurly size={10} weight="bold" /> Codex
          </span>
        )}
        {message.streaming && (
          <span className="tag live">
            <span className="streamDot" /> streaming
          </span>
        )}
      </div>
      <div className="bubble">
        {message.text ? (
          <MarkdownRenderer content={message.text} />
        ) : (
          message.streaming && (
            <span className="skeletonLine">
              <span />
              <span />
              <span />
            </span>
          )
        )}
        {message.streaming && message.text && <span className="caret" />}
      </div>
    </article>
  );
};
export default ChatBubble;
