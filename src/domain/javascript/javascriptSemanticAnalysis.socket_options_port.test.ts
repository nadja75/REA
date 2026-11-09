import { expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";

/**
 * `net.connect` and `tls.connect` judge the same port value whether it arrives positionally
 * or inside an options object, and both spellings are read by one shared value rule.
 *
 * Measured on Node 24.22.1:
 *
 * | call | outcome |
 * | --- | --- |
 * | `net.connect({port: -1})`, `{port: 70000}`, `{port: "x"}`, `{port: null}` | THREW `ERR_SOCKET_BAD_PORT` |
 * | `net.connect({port: 8080})`, `{port: "8080"}`, `{port: 0}` | socket created |
 * | `tls.connect({path: "/tmp/x.sock", port: -1})` | socket created — the path neutralises the port |
 */
const acquisitionsFor = (body: string) =>
  analyzeJavaScriptSemantics(
    `import net from "node:net";\nimport tls from "node:tls";\nfunction f() { ${body}; }`,
  ).resourceOperations.filter(({ kind }) => kind === "acquire");

it.each([
  [`net.connect({ port: -1 })`],
  [`net.connect({ port: 70000 })`],
  [`net.connect({ port: "x" })`],
  [`net.connect({ port: null })`],
  [`tls.connect({ port: -1 })`],
] as const)("emits no acquisition for a rejected options port: %s", (call) => {
  expect(acquisitionsFor(call)).toEqual([]);
});

it.each([
  [`net.connect({ port: 8080 })`],
  // A numeric string is coerced with `Number`, so it is a usable port.
  [`net.connect({ port: "8080" })`],
  [`net.connect({ port: 0 })`],
  [`tls.connect({ port: 443 })`],
  // A non-empty path becomes the Unix socket, so the port is never read.
  [`tls.connect({ path: "/tmp/x.sock", port: -1 })`],
] as const)(
  "keeps the acquisition for an accepted options port: %s",
  (call) => {
    expect(acquisitionsFor(call)).toHaveLength(1);
  },
);

it.each([
  // A string in the positional slot is a Unix path, so only an empty one fails.
  [`net.connect("-1")`],
  [`net.connect("/tmp/x.sock")`],
  [`tls.connect("/tmp/x.sock")`],
  [`tls.connect("/tmp/x.sock", {})`],
  // `tls` reads an options object in slot 1 after an empty path.
  [`tls.connect("", { port: 80 })`],
  [`tls.connect("", { path: "/tmp/x" })`],
] as const)("keeps the acquisition for a path spelling: %s", (call) => {
  expect(acquisitionsFor(call)).toHaveLength(1);
});

it.each([
  // An empty path leaves nothing to connect to, and the options object does not supply one.
  [`net.connect("")`],
  [`tls.connect("", {})`],
] as const)(
  "emits no acquisition for an empty path with no target: %s",
  (call) => {
    expect(acquisitionsFor(call)).toEqual([]);
  },
);
