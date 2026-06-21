import Prism from "prismjs";
import "prismjs/components/prism-bash.js";
import "prismjs/components/prism-c.js";
import "prismjs/components/prism-cpp.js";
import "prismjs/components/prism-csharp.js";
import "prismjs/components/prism-css.js";
import "prismjs/components/prism-docker.js";
import "prismjs/components/prism-go.js";
import "prismjs/components/prism-ini.js";
import "prismjs/components/prism-java.js";
import "prismjs/components/prism-json.js";
import "prismjs/components/prism-jsx.js";
import "prismjs/components/prism-kotlin.js";
import "prismjs/components/prism-markup-templating.js";
import "prismjs/components/prism-php.js";
import "prismjs/components/prism-python.js";
import "prismjs/components/prism-ruby.js";
import "prismjs/components/prism-rust.js";
import "prismjs/components/prism-sql.js";
import "prismjs/components/prism-typescript.js";
import "prismjs/components/prism-tsx.js";
import "prismjs/components/prism-swift.js";
import "prismjs/components/prism-toml.js";
import "prismjs/components/prism-yaml.js";

const EXTENSION_LANGUAGES: Record<string, string> = {
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  py: "python",
  json: "json",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  java: "java",
  sql: "sql",
  css: "css",
  html: "markup",
  htm: "markup",
  xml: "markup",
  svg: "markup",
  vue: "markup",
  c: "c",
  h: "c",
  cpp: "cpp",
  cxx: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  go: "go",
  rs: "rust",
  rb: "ruby",
  php: "php",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  toml: "toml",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  yml: "yaml",
  yaml: "yaml",
};

const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  sh: "bash",
  shell: "bash",
  yml: "yaml",
  html: "markup",
  xml: "markup",
};

export function languageForPath(path: string): string | null {
  const name = path.split("/").pop()?.toLowerCase() || "";
  if (name === "dockerfile") return "docker";
  const extension = name.split(".").pop()?.toLowerCase();
  return (extension && EXTENSION_LANGUAGES[extension]) || null;
}

export function languageForCodeFence(language: string): string | null {
  const normalized = language.trim().toLowerCase();
  if (!normalized) return null;
  const candidate = LANGUAGE_ALIASES[normalized] || normalized;
  return activePrism().languages[candidate] ? candidate : null;
}

export function highlightCode(content: string, language: string | null): string | null {
  if (!content || !language) return null;
  const prism = activePrism();
  const grammar = prism.languages[language];
  if (!grammar) return null;
  try {
    return prism.highlight(content, grammar, language);
  } catch {
    // Highlighting must never stop a file from opening. The caller uses plain text instead.
    return null;
  }
}

function activePrism(): typeof Prism {
  // Prism language modules register themselves on the browser-wide instance.
  // Vite can wrap the base import separately, so use that populated instance first.
  return globalThis.Prism || Prism;
}
