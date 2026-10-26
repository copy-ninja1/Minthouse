import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FetchLimitError, UnsafeUrlError, createSafeFetcher, isPublicAddress } from "../src/security/safe-fetch.js";

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "255.255.255.255",
    "224.0.0.1",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "64:ff9b::a00:1",
    "2002:7f00:1::",
    "not-an-ip",
  ])("refuses %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["8.8.8.8", "104.16.1.1", "2606:4700::1111", "::ffff:8.8.8.8"])("allows %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});

/**
 * The fetcher talks to a real local HTTP server. To exercise the https-only
 * and public-address rules without the internet, the tests inject a resolver
 * and an address policy, and mark the local server as a trusted origin only
 * where a test needs to reach it.
 */
describe("createSafeFetcher", () => {
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      switch (request.url ?? "") {
        case "/ok":
          response.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
          return;
        case "/big":
          response.writeHead(200, { "content-type": "application/octet-stream" }).end(Buffer.alloc(4096));
          return;
        case "/big-chunked":
          response.writeHead(200);
          for (let i = 0; i < 8; i++) {
            response.write(Buffer.alloc(1024));
          }
          response.end();
          return;
        case "/redirect-internal":
          response.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" }).end();
          return;
        case "/redirect-https-private":
          response.writeHead(302, { location: "https://internal.example/secret" }).end();
          return;
        case "/redirect-loop":
          response.writeHead(302, { location: "/redirect-loop" }).end();
          return;
        case "/redirect-ok":
          response.writeHead(301, { location: "/ok" }).end();
          return;
        default:
          response.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("rejects non-https schemes, credentials and non-default ports", async () => {
    const fetcher = createSafeFetcher();
    await expect(fetcher("http://example.com/x", { maxBytes: 10 })).rejects.toThrow(UnsafeUrlError);
    await expect(fetcher("file:///etc/passwd", { maxBytes: 10 })).rejects.toThrow("Only https");
    await expect(fetcher("ftp://example.com/x", { maxBytes: 10 })).rejects.toThrow("Only https");
    await expect(fetcher("https://user:pass@example.com/x", { maxBytes: 10 })).rejects.toThrow("credentials");
    await expect(fetcher("https://example.com:8443/x", { maxBytes: 10 })).rejects.toThrow("default https port");
    await expect(fetcher("not a url", { maxBytes: 10 })).rejects.toThrow("Invalid URL");
  });

  it("rejects private and encoded IP literals without resolving them", async () => {
    const fetcher = createSafeFetcher({
      resolve: () => Promise.reject(new Error("must not resolve IP literals")),
    });
    for (const url of [
      "https://127.0.0.1/",
      "https://2130706433/",
      "https://0x7f.1/",
      "https://[::1]/",
      "https://[::ffff:169.254.169.254]/",
      "https://169.254.169.254/latest/meta-data",
      "https://10.0.0.1/",
    ]) {
      await expect(fetcher(url, { maxBytes: 10 }), url).rejects.toThrow("non-public");
    }
  });

  it("rejects hostnames when any resolved address is private (DNS rebinding)", async () => {
    const fetcher = createSafeFetcher({
      resolve: () =>
        Promise.resolve([
          { address: "93.184.216.34", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ]),
    });
    await expect(fetcher("https://rebind.example/", { maxBytes: 10 })).rejects.toThrow("non-public");
  });

  it("re-validates every redirect hop", async () => {
    const trusted = createSafeFetcher({ trustedOrigins: [origin] });
    await expect(trusted(`${origin}/redirect-internal`, { maxBytes: 100 })).rejects.toThrow("Only https");

    const withPrivateDns = createSafeFetcher({
      trustedOrigins: [origin],
      resolve: () => Promise.resolve([{ address: "10.0.0.5", family: 4 }]),
    });
    await expect(withPrivateDns(`${origin}/redirect-https-private`, { maxBytes: 100 })).rejects.toThrow("non-public");
  });

  it("limits the number of redirects", async () => {
    const fetcher = createSafeFetcher({ trustedOrigins: [origin] });
    await expect(fetcher(`${origin}/redirect-loop`, { maxBytes: 100, maxRedirects: 3 })).rejects.toThrow("More than 3 redirects");
  });

  it("follows safe redirects and returns the body", async () => {
    const fetcher = createSafeFetcher({ trustedOrigins: [origin] });
    const result = await fetcher(`${origin}/redirect-ok`, { maxBytes: 100 });
    expect(result.status).toBe(200);
    expect(result.url).toBe(`${origin}/ok`);
    expect(result.contentType).toBe("application/json");
    expect(JSON.parse(result.body.toString())).toEqual({ ok: true });
  });

  it("enforces the size limit by header and while streaming", async () => {
    const fetcher = createSafeFetcher({ trustedOrigins: [origin] });
    await expect(fetcher(`${origin}/big`, { maxBytes: 1000 })).rejects.toThrow(FetchLimitError);
    await expect(fetcher(`${origin}/big-chunked`, { maxBytes: 2000 })).rejects.toThrow(FetchLimitError);
  });

  it("pins the connection to the validated address", async () => {
    const port = new URL(origin).port;
    const fetcher = createSafeFetcher({
      resolve: () => Promise.resolve([{ address: "127.0.0.1", family: 4 }]),
      isAllowedAddress: (address) => address === "127.0.0.1",
      trustedOrigins: [`http://pinned.test:${port}`],
    });
    const result = await fetcher(`http://pinned.test:${port}/ok`, { maxBytes: 100 });
    expect(result.status).toBe(200);
  });
});
