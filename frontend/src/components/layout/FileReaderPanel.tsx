import { FileCode2, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { Project } from "../../types";
import * as api from "../../services/api";
import { highlightCode, languageForPath } from "../../utils/syntaxHighlight";
import MarkdownRenderer from "../common/MarkdownRenderer";

export default function FileReaderPanel({
  project,
  path,
  width,
  isMobile = false,
  onClose,
}: {
  project: Project;
  path: string;
  width: number;
  isMobile?: boolean;
  onClose: () => void;
}) {
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setContent("");
    setError("");
    setLoading(true);
    api
      .fetchProjectFileContent(project.id, path)
      .then((result) => {
        if (!cancelled) setContent(result.content);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Could not load file");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [path, project.id]);

  const markdown = /\.mdx?$/i.test(path);
  const language = languageForPath(path);
  const highlighted = highlightCode(content, language);
  return (
    <aside
      style={{ width: isMobile ? "100%" : `${width}px` }}
      className="flex min-h-0 shrink-0 flex-col border-l border-line bg-surface-0"
    >
      <div className="flex items-center gap-2 border-b border-line-soft px-3 py-2.5">
        <FileCode2 className="h-4 w-4 text-accent" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{path}</span>
        <button
          title="Close file"
          onClick={onClose}
          className="grid h-7 w-7 place-items-center rounded text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4 text-[12.5px]">
        {error ? (
          <p className="text-danger">{error}</p>
        ) : loading ? (
          <p className="text-fg-dim">Loading file…</p>
        ) : markdown ? (
          <MarkdownRenderer content={content} />
        ) : (
          <pre className="file-preview whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
            <code
              className={language ? `language-${language}` : undefined}
              dangerouslySetInnerHTML={highlighted ? { __html: highlighted } : undefined}
            >
              {highlighted ? undefined : content}
            </code>
          </pre>
        )}
      </div>
    </aside>
  );
}
