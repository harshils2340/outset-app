import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { assertPublicUrl, isBlockedAddress, safeFetch, UnsafeUrlError } from "../safeFetch.ts";

/**
 * A hacked operator site, a vendor's JSON, or a redirect can all name an address on this server's own
 * network: localhost, the private ranges, the cloud metadata address, or an internal-only name, plus the
 * same set again for whatever a redirect hop points at.
 */
test("blocked addresses are refused", () => {
  for (const addr of ["127.0.0.1", "127.10.2.3", "0.0.0.0", "10.1.2.3", "172.16.0.5", "172.31.255.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fc00::1", "fd12::9", "fe80::1"]) {
    assert.equal(isBlockedAddress(addr), true, addr + " should be blocked");
  }
});

test("ordinary public addresses are allowed", () => {
  for (const addr of ["93.184.216.34", "8.8.8.8", "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "2001:4860:4860::8888"]) {
    assert.equal(isBlockedAddress(addr), false, addr + " should be allowed");
  }
});

test("only http and https schemes are allowed", async () => {
  await assert.rejects(() => assertPublicUrl(new URL("file:///etc/passwd")), UnsafeUrlError);
  await assert.rejects(() => assertPublicUrl(new URL("ftp://example.com/x")), UnsafeUrlError);
  await assert.rejects(() => assertPublicUrl(new URL("gopher://example.com/x")), UnsafeUrlError);
});

test("internal-only name suffixes and bare hostnames are refused before any lookup", async () => {
  for (const url of ["http://printer.local/", "http://box.internal/", "http://thing.localhost/", "http://printer/"]) {
    await assert.rejects(() => assertPublicUrl(new URL(url)), UnsafeUrlError, url + " should be refused");
  }
});

test("a literal private IP in the URL is refused without a DNS lookup", async () => {
  await assert.rejects(() => assertPublicUrl(new URL("http://127.0.0.1:6379/")), UnsafeUrlError);
  await assert.rejects(() => assertPublicUrl(new URL("http://[::1]/")), UnsafeUrlError);
  await assert.rejects(() => assertPublicUrl(new URL("http://169.254.169.254/latest/meta-data/")), UnsafeUrlError);
});

test("safeFetch refuses a host a fake resolver says is private, with no real DNS or network", async () => {
  await assert.rejects(
    () =>
      safeFetch("http://attacker-controlled.example/", {
        resolveForTest: async () => ["10.0.0.5"],
      }),
    UnsafeUrlError,
  );
});

test("safeFetch re-checks a redirect's target, not only the URL it started with", async () => {
  // The site itself resolves fine; the fake resolver only refuses the address the redirect points at.
  const server = createServer((req, res) => {
    res.writeHead(302, { location: "http://internal-only.example/secret" });
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  try {
    await assert.rejects(
      () =>
        safeFetch(`http://127.0.0.1:${port}/`, {
          // The starting host resolves "public" so the request actually reaches the local server and gets
          // redirected; only the redirect's own target is the one the fake resolver calls private.
          resolveForTest: async (host) => (host === "internal-only.example" ? ["10.0.0.9"] : ["93.184.216.34"]),
        }),
      UnsafeUrlError,
    );
  } finally {
    server.close();
  }
});

test("safeFetch refuses a body larger than maxBytes", async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("x".repeat(200_000));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  try {
    await assert.rejects(
      () =>
        safeFetch(`http://127.0.0.1:${port}/`, {
          resolveForTest: async () => ["93.184.216.34"],
          maxBytes: 1000,
        }),
      UnsafeUrlError,
    );
  } finally {
    server.close();
  }
});

test("safeFetch returns the body and final URL for an ordinary same-host response", async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("hello");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  try {
    // The fake resolver stands in for "this host is public"; the request still lands on the local test server.
    const res = await safeFetch(`http://127.0.0.1:${port}/page`, { resolveForTest: async () => ["93.184.216.34"] });
    assert.equal(res.ok, true);
    assert.equal(await res.text(), "hello");
    assert.ok(res.url.endsWith("/page"));
  } finally {
    server.close();
  }
});

test("safeFetch gives up after too many redirect hops", async () => {
  const server = createServer((req, res) => {
    res.writeHead(302, { location: "/next" });
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  try {
    await assert.rejects(
      () =>
        safeFetch(`http://127.0.0.1:${port}/`, {
          resolveForTest: async () => ["93.184.216.34"],
          maxRedirects: 2,
        }),
      UnsafeUrlError,
    );
  } finally {
    server.close();
  }
});
