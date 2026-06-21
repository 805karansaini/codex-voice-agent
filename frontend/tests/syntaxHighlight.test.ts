import assert from "node:assert/strict";
import test from "node:test";

import { highlightCode, languageForCodeFence, languageForPath } from "../src/utils/syntaxHighlight.ts";

test("recognizes common file types and Dockerfiles", () => {
  assert.equal(languageForPath("src/server.py"), "python");
  assert.equal(languageForPath("package.json"), "json");
  assert.equal(languageForPath("index.html"), "markup");
  assert.equal(languageForPath("Dockerfile"), "docker");
  assert.equal(languageForPath("notes.md"), null);
});

test("highlights JSON and Python without throwing", () => {
  const json = highlightCode('{"active": true}', languageForPath("package.json"));
  const python = highlightCode("def greet(name):\n    return name", languageForPath("greet.py"));
  assert.match(json || "", /token/);
  assert.match(python || "", /token/);
});

test("highlights the other common file languages", () => {
  const examples = [
    ["index.html", "<h1>Hello</h1>"],
    ["styles.css", ".app { color: red; }"],
    ["Main.java", "class Main { public static void main(String[] args) {} }"],
    ["app.ts", "const answer: number = 42;"],
    ["query.sql", "SELECT id FROM users;"],
    ["config.yaml", "enabled: true"],
  ] as const;
  for (const [path, content] of examples) {
    assert.match(highlightCode(content, languageForPath(path)) || "", /token/);
  }
});

test("uses supported Markdown fence aliases and safely leaves unknown types plain", () => {
  assert.equal(languageForCodeFence("py"), "python");
  assert.equal(languageForCodeFence("json"), "json");
  assert.equal(languageForCodeFence("not-a-language"), null);
  assert.equal(highlightCode("text", null), null);
});
