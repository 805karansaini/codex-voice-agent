import assert from "node:assert/strict";
import test from "node:test";

import { readSseStream } from "../src/utils/sse.ts";

function responseFromChunks(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    })
  );
}

test("readSseStream parses events split across chunks", async () => {
  const events: unknown[] = [];
  await readSseStream(
    responseFromChunks([
      'data: {"type":"delta","text":"hel',
      'lo"}\n\n',
      'data: {"type":"done"}\n\n',
    ]),
    (event) => events.push(event)
  );

  assert.deepEqual(events, [
    { type: "delta", text: "hello" },
    { type: "done" },
  ]);
});

test("readSseStream joins multiline data frames before parsing JSON", async () => {
  const events: unknown[] = [];
  await readSseStream(
    responseFromChunks([
      'event: message\n',
      'data: {"type":"delta",\n',
      'data: "text":"hello"}\n\n',
    ]),
    (event) => events.push(event)
  );

  assert.deepEqual(events, [{ type: "delta", text: "hello" }]);
});

test("readSseStream skips malformed frames and continues reading", async () => {
  const events: unknown[] = [];
  await readSseStream(
    responseFromChunks([
      "data: not-json\n\n",
      'data: {"type":"ok","value":1}\n\n',
    ]),
    (event) => events.push(event)
  );

  assert.deepEqual(events, [{ type: "ok", value: 1 }]);
});
