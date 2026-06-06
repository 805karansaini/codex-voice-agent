import React from "react";
import { ChatText, PencilSimple, Trash, Plus } from "@phosphor-icons/react";
import { Chat } from "../../types";

interface ChatListProps {
  projectId: string;
  chats: Chat[];
  activeChatId: string;
  onSelectChat: (projectId: string, chatId: string) => void;
  onRenameChat: (projectId: string, chatId: string, title: string) => void;
  onRemoveChat: (projectId: string, chatId: string) => void;
  onCreateChat: (projectId: string) => void;
  projectColor?: string;
}

export const ChatList: React.FC<ChatListProps> = ({
  projectId,
  chats,
  activeChatId,
  onSelectChat,
  onRenameChat,
  onRemoveChat,
  onCreateChat,
  projectColor,
}) => {
  return (
    <div className="chatList" style={{ ["--projColor" as string]: projectColor }}>
      {chats.map((c) => {
        const isCurrent = c.id === activeChatId;
        return (
          <div
            key={c.id}
            className={`chatRow ${isCurrent ? "active" : ""}`}
            onClick={() => onSelectChat(projectId, c.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                onSelectChat(projectId, c.id);
              }
            }}
          >
            <ChatText size={14} weight={isCurrent ? "fill" : "regular"} />
            <span className="chatTitle">{c.title}</span>
            <span className="chatActions">
              <span
                role="button"
                tabIndex={-1}
                aria-label="Rename chat"
                onClick={(e) => {
                  e.stopPropagation();
                  const next = window.prompt("Rename chat", c.title);
                  if (next !== null) onRenameChat(projectId, c.id, next);
                }}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <PencilSimple size={13} weight="bold" />
              </span>
              <span
                role="button"
                tabIndex={-1}
                aria-label="Delete chat"
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`Delete chat “${c.title}”?`)) {
                    onRemoveChat(projectId, c.id);
                  }
                }}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <Trash size={13} weight="bold" />
              </span>
            </span>
          </div>
        );
      })}
      <button className="newChat" type="button" onClick={() => onCreateChat(projectId)}>
        <Plus size={13} weight="bold" /> New chat
      </button>
    </div>
  );
};
export default ChatList;
