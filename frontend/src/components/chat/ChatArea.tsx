import React, { useEffect, useRef } from "react";
import { FolderPlus, Terminal, Lightning } from "@phosphor-icons/react";
import { Project, Message } from "../../types";
import ChatBubble from "./ChatBubble";

interface ChatAreaProps {
  activeProject: Project | null;
  messages: Message[];
  busy: boolean;
  mode: "agent" | "codex";
  onSend: (text: string) => void;
  onNewProjectClick: () => void;
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  activeProject,
  messages,
  busy,
  mode,
  onSend,
  onNewProjectClick,
}) => {
  const streamRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    if (streamRef.current) {
      streamRef.current.scrollTo({
        top: streamRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, busy, activeProject?.id]);

  const suggestions =
    mode === "codex"
      ? [
          "List the files in this directory",
          "Show the git status",
          "Run the test suite",
          "Summarize this codebase",
        ]
      : [
          "How many files are in this project?",
          "What changed in the last commit?",
          "Pull the latest from git",
          "Explain the project structure",
        ];

  if (!activeProject) {
    return (
      <div className="stream" ref={streamRef}>
        <div className="empty">
          <div className="emptyMark">
            <FolderPlus size={26} weight="duotone" />
          </div>
          <h3>Create your first project</h3>
          <p>
            A project pins the agent to a folder on this machine. Ask it to read files, run git, or
            hand work to Codex — everything runs with that directory as the present working
            directory.
          </p>
          <div className="suggestRow">
            <button className="suggest" type="button" onClick={onNewProjectClick}>
              <FolderPlus size={15} weight="bold" /> Add a project
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stream" ref={streamRef}>
      {messages.length === 0 ? (
        <div className="empty">
          <div className="emptyMark">
            <Terminal size={24} weight="duotone" />
          </div>
          <h3>{activeProject.name}</h3>
          <p>
            Working in{" "}
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--lime)" }}>
              {activeProject.path}
            </span>
            . Ask a question, run a task, or go live with voice.
          </p>
          <div className="suggestRow">
            {suggestions.map((s) => (
              <button key={s} className="suggest" type="button" onClick={() => onSend(s)}>
                <Lightning size={14} weight="fill" /> {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="streamInner">
          {messages.map((m, index) => (
            <ChatBubble key={m.id} message={m} index={index} />
          ))}
          {busy && mode === "agent" && !messages.some((m) => m.streaming) && (
            <article className="msg assistant">
              <div className="msgHead">
                <span className="who">Agent</span>
              </div>
              <div className="bubble">
                <span className="skeletonLine">
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            </article>
          )}
        </div>
      )}
    </div>
  );
};
export default ChatArea;
