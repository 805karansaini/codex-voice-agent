import React, { useEffect, useRef, useState } from "react";
import { Check, CircleAlert, Copy } from "lucide-react";
import { safeExternalUrl } from "../../utils/links";
import { copyTextToClipboard } from "../../utils/clipboard";
import { useSyntaxHighlight } from "../../hooks/useSyntaxHighlight";

interface MarkdownRendererProps {
  content: string;
}

export const MarkdownRenderer = React.memo(function MarkdownRenderer({
  content,
}: MarkdownRendererProps) {
  if (!content) return null;

  // Split by code blocks
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="markdown-content">
      {parts.map((part, index) => {
        if (part.startsWith("```")) {
          // Parse code block
          const match = part.match(/```(\w*)\n([\s\S]*?)```/);
          const lang = match ? match[1] : "";
          const code = match ? match[2] : part.slice(3, -3);

          return <CodeBlock key={index} language={lang} code={code} />;
        } else {
          // Parse standard text blocks
          return <TextBlock key={index} text={part} />;
        }
      })}
    </div>
  );
});

interface CodeBlockProps {
  language: string;
  code: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ language, code }) => {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const resetTimer = useRef<number | undefined>(undefined);
  const { language: highlightLanguage, highlighted } = useSyntaxHighlight(
    code.trim(),
    language,
    "fence",
  );

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const handleCopy = async () => {
    window.clearTimeout(resetTimer.current);
    setCopyStatus("copying");

    const copied = await copyTextToClipboard(code);
    setCopyStatus(copied ? "copied" : "failed");
    resetTimer.current = window.setTimeout(() => setCopyStatus("idle"), copied ? 2000 : 3000);
  };

  const copyLabel =
    copyStatus === "copying"
      ? "Copying…"
      : copyStatus === "copied"
        ? "Copied!"
        : copyStatus === "failed"
          ? "Copy failed"
          : "Copy";

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span className="code-block-lang">{language || "text"}</span>
        <button
          type="button"
          className="code-block-copy"
          onClick={() => void handleCopy()}
          disabled={copyStatus === "copying"}
          title={copyStatus === "failed" ? "Unable to copy code. Try again." : "Copy code"}
        >
          {copyStatus === "copied" ? (
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          ) : copyStatus === "failed" ? (
            <CircleAlert className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          <span>{copyLabel}</span>
        </button>
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {copyStatus === "copied"
            ? "Code copied to clipboard."
            : copyStatus === "failed"
              ? "Unable to copy code to the clipboard."
              : ""}
        </span>
      </div>
      <pre className="code-block-pre file-preview">
        <code
          className={`code-block-code${highlightLanguage ? ` language-${highlightLanguage}` : ""}`}
          dangerouslySetInnerHTML={highlighted ? { __html: highlighted } : undefined}
        >
          {highlighted ? undefined : code.trim()}
        </code>
      </pre>
    </div>
  );
};

interface TextBlockProps {
  text: string;
}

const TextBlock: React.FC<TextBlockProps> = ({ text }) => {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let currentList: React.ReactNode[] = [];
  let inList = false;

  const flushList = (key: number) => {
    if (currentList.length > 0) {
      elements.push(
        <ul key={`list-${key}`} className="markdown-list">
          {...currentList}
        </ul>,
      );
      currentList = [];
    }
  };

  lines.forEach((line, lineIdx) => {
    const trimmed = line.trim();

    // List item check
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      inList = true;
      const content = line.substring(line.indexOf(" ") + 1);
      currentList.push(
        <li key={`li-${lineIdx}`} className="markdown-list-item">
          {parseInline(content)}
        </li>,
      );
    } else {
      if (inList) {
        flushList(lineIdx);
        inList = false;
      }

      if (trimmed === "") {
        return;
      }

      // Headers check
      if (trimmed.startsWith("#")) {
        const hashMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
        if (hashMatch) {
          const level = hashMatch[1].length;
          const headerText = hashMatch[2];
          const children = parseInline(headerText);
          const key = `h-${lineIdx}`;
          const className = `markdown-h${level}`;
          switch (level) {
            case 1:
              elements.push(
                <h1 key={key} className={className}>
                  {children}
                </h1>,
              );
              break;
            case 2:
              elements.push(
                <h2 key={key} className={className}>
                  {children}
                </h2>,
              );
              break;
            case 3:
              elements.push(
                <h3 key={key} className={className}>
                  {children}
                </h3>,
              );
              break;
            case 4:
              elements.push(
                <h4 key={key} className={className}>
                  {children}
                </h4>,
              );
              break;
            case 5:
              elements.push(
                <h5 key={key} className={className}>
                  {children}
                </h5>,
              );
              break;
            case 6:
              elements.push(
                <h6 key={key} className={className}>
                  {children}
                </h6>,
              );
              break;
            default:
              elements.push(
                <p key={key} className={className}>
                  {children}
                </p>,
              );
              break;
          }
          return;
        }
      }

      // Standard paragraph
      elements.push(
        <p key={`p-${lineIdx}`} className="markdown-paragraph">
          {parseInline(line)}
        </p>,
      );
    }
  });

  if (inList) {
    flushList(lines.length);
  }

  return <>{elements}</>;
};

// Inline markdown parser: **bold**, `code`, links [text](url)
const parseInline = (text: string): React.ReactNode[] => {
  const boldParts = text.split(/(\*\*.*?\*\*)/g);

  return boldParts.flatMap((part, bIdx) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      const boldText = part.slice(2, -2);
      return parseCodeAndLinks(boldText, `bold-${bIdx}`);
    }
    return parseCodeAndLinks(part, `text-${bIdx}`);
  });
};

const parseCodeAndLinks = (text: string, keyPrefix: string): React.ReactNode[] => {
  const codeParts = text.split(/(`.*?`)/g);

  return codeParts.flatMap((part, cIdx) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      const codeText = part.slice(1, -1);
      return (
        <code key={`${keyPrefix}-code-${cIdx}`} className="markdown-inline-code">
          {codeText}
        </code>
      );
    }
    return parseLinks(part, `${keyPrefix}-plain-${cIdx}`);
  });
};

const parseLinks = (text: string, keyPrefix: string): React.ReactNode[] => {
  const linkParts = text.split(/(\[.*?\]\(.*?\))/g);

  return linkParts.map((part, lIdx) => {
    const match = part.match(/\[(.*?)\]\((.*?)\)/);
    if (match) {
      const linkText = match[1];
      const linkUrl = safeExternalUrl(match[2]);
      if (!linkUrl) return linkText;
      return (
        <a
          key={`${keyPrefix}-link-${lIdx}`}
          href={linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="markdown-link"
        >
          {linkText}
        </a>
      );
    }
    return part;
  });
};
export default MarkdownRenderer;
