import { expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";

/**
 * `http.request` and `https.request` validate `options.method` with `checkIsHttpToken`
 * before they build the request, so a literal outside the token set throws
 * `ERR_INVALID_HTTP_TOKEN` from the call itself and no request exists.
 *
 * Measured on Node 24.22.1: `"GET"`, `"get"`, `"M-SEARCH"`, `"X"` and the punctuation set
 * `"!#$%&'*+-.^_`|~"` all construct a request; `"BAD METHOD"`, `"G/ET"`, `"G:ET"`,
 * `"G,ET"`, `"GET "`, `" "` and `"GéT"` throw. An empty string is accepted, because Node
 * reads `""` as "not given" and falls back to `GET`.
 */
const requestsFor = (body: string) =>
  analyzeJavaScriptSemantics(
    `import http from "node:http";\nimport https from "node:https";\nfunction f() { ${body}; }`,
  ).requestOperations;

it.each([
  [`http.request({ host: "h", path: "/", method: "BAD METHOD" })`],
  [`http.request({ host: "h", path: "/", method: "G/ET" })`],
  [`http.request({ host: "h", path: "/", method: "G:ET" })`],
  [`http.request({ host: "h", path: "/", method: "GET " })`],
  [`http.request({ host: "h", path: "/", method: " " })`],
  [`http.request({ host: "h", path: "/", method: "GéT" })`],
  [`https.request({ host: "h", path: "/", method: "BAD METHOD" })`],
  [`http.get({ host: "h", path: "/", method: "BAD METHOD" })`],
] as const)("emits no request for a rejected method token: %s", (call) => {
  expect(requestsFor(call)).toEqual([]);
});

it.each([
  [`http.request({ host: "h", path: "/", method: "GET" })`],
  [`http.request({ host: "h", path: "/", method: "get" })`],
  [`http.request({ host: "h", path: "/", method: "M-SEARCH" })`],
  [`http.request({ host: "h", path: "/", method: "X" })`],
  // Node reads an empty method as "not given" and falls back to GET.
  [`http.request({ host: "h", path: "/", method: "" })`],
  [`http.request({ host: "h", path: "/" })`],
  // `fetch` reads a different member and validates no token.
  [`fetch("http://h/", { method: "BAD METHOD" })`],
  // A binding is not a literal, so this file leaves the answer to the runtime.
  [`const m = "BAD METHOD"; http.request({ host: "h", method: m })`],
] as const)("keeps the request for an accepted method: %s", (call) => {
  expect(requestsFor(call)).toHaveLength(1);
});

it.each([
  // An erased TypeScript assertion is the same object at runtime, so the method is still
  // validated. Measured on Node 24.22.1, this throws ERR_INVALID_HTTP_TOKEN.
  [
    `http.request(({ host: "h", method: "BAD METHOD" } as any))`,
    `http.request(({ host: "h", method: "BAD METHOD" }) as any)`,
  ],
] as const)(
  "reads the options through an erased assertion: %s",
  (_name, call) => {
    expect(
      analyzeJavaScriptSemantics(
        `import http from "node:http";\nfunction f() { ${call}; }`,
      ).requestOperations,
    ).toEqual([]);
  },
);

it("keeps the request when a leading spread shifts the options slot", () => {
  // The spread supplies the options and the callback, so the trailing object is ignored
  // and Node builds a GET request. Measured on Node 24.22.1.
  const operations = analyzeJavaScriptSemantics(
    `import http from "node:http";\nfunction f() { const a = [{ host: "h" }, () => {}]; http.request(...a, { method: "BAD METHOD" }); }`,
  ).requestOperations;
  expect(operations).toHaveLength(1);
});
