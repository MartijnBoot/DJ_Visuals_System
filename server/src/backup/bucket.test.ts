// B-12 T15 (SD10, PD25): SigV4 on node:crypto and the S3-compatible bucket client.
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createBucket, listKeys, signV4 } from "./bucket.ts";

const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("signV4", () => {
  // The AWS SigV4 test suite's `get-vanilla` (awslabs/aws-c-auth,
  // tests/aws-signing-test-suite/v4/get-vanilla): its canonical request, string to sign and
  // signature, as published.
  it("signs the test suite's get-vanilla to its published signature", () => {
    const signed = signV4({
      method: "GET",
      path: "/",
      query: [],
      headers: { host: "example.amazonaws.com", "x-amz-date": "20150830T123600Z" },
      payloadHash: EMPTY_HASH,
      region: "us-east-1",
      service: "service",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    });
    expect(signed.canonicalRequest).toBe(
      [
        "GET",
        "/",
        "",
        "host:example.amazonaws.com",
        "x-amz-date:20150830T123600Z",
        "",
        "host;x-amz-date",
        EMPTY_HASH,
      ].join("\n"),
    );
    expect(signed.stringToSign).toBe(
      [
        "AWS4-HMAC-SHA256",
        "20150830T123600Z",
        "20150830/us-east-1/service/aws4_request",
        "bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63",
      ].join("\n"),
    );
    expect(signed.signature).toBe(
      "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    );
    expect(signed.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    );
  });

  it("sorts and encodes the query, RFC 3986 style", () => {
    const signed = signV4({
      method: "GET",
      path: "/b",
      query: [
        ["prefix", "djvisuals-"],
        ["a b", "x*y"],
      ],
      headers: { host: "h", "x-amz-date": "20150830T123600Z" },
      payloadHash: EMPTY_HASH,
      region: "r",
      service: "s3",
      accessKeyId: "k",
      secretAccessKey: "s",
    });
    expect(signed.canonicalRequest.split("\n")[2]).toBe("a%20b=x%2Ay&prefix=djvisuals-");
  });
});

describe("listKeys", () => {
  it("reads every <Key>, unescaping XML entities", () => {
    const xml =
      '<?xml version="1.0"?><ListBucketResult><Name>b</Name><Contents><Key>djvisuals-1.sqlite</Key><Size>3</Size></Contents><Contents><Key>a&amp;b</Key></Contents></ListBucketResult>';
    expect(listKeys(xml)).toEqual(["djvisuals-1.sqlite", "a&b"]);
  });
});

describe("createBucket against a stand-in", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  async function standIn(handle: (req: IncomingMessage, body: Buffer) => [number, string]) {
    const seen: { method: string; url: string; headers: IncomingMessage["headers"] }[] = [];
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      seen.push({ method: req.method!, url: req.url!, headers: req.headers });
      const [status, text] = handle(req, Buffer.concat(chunks));
      res.statusCode = status;
      res.end(text);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    close = () => new Promise<void>((r) => server.close(() => r()));
    return { seen, endpoint: `http://127.0.0.1:${port}` };
  }

  const options = (endpoint: string) => ({
    endpoint,
    region: "eu-amsterdam-1",
    bucket: "backups",
    accessKeyId: "key-id",
    secretAccessKey: "secret-never-logged",
    fetch: ((input, init) => fetch(input, init)) as typeof fetch,
    now: () => Date.parse("2026-11-17T03:00:00.000Z"),
  });

  it("puts path-style with the payload's hash and a SigV4 authorization", async () => {
    const { seen, endpoint } = await standIn(() => [200, ""]);
    const body = new Uint8Array([1, 2, 3]);
    await createBucket(options(endpoint)).put("djvisuals-x.sqlite", body);
    expect(seen[0]!.method).toBe("PUT");
    expect(seen[0]!.url).toBe("/backups/djvisuals-x.sqlite");
    expect(seen[0]!.headers["x-amz-content-sha256"]).toBe(
      createHash("sha256").update(body).digest("hex"),
    );
    expect(seen[0]!.headers["x-amz-date"]).toBe("20261117T030000Z");
    expect(seen[0]!.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=key-id\/20261117\/eu-amsterdam-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  it("lists with ListObjects (v1) and a prefix", async () => {
    const { seen, endpoint } = await standIn(() => [
      200,
      "<ListBucketResult><Contents><Key>djvisuals-2.sqlite</Key></Contents></ListBucketResult>",
    ]);
    expect(await createBucket(options(endpoint)).list("djvisuals-")).toEqual([
      "djvisuals-2.sqlite",
    ]);
    expect(seen[0]!.url).toBe("/backups?prefix=djvisuals-");
  });

  it("gets bytes, and null for a missing object", async () => {
    const { endpoint } = await standIn((req) =>
      req.url === "/backups/there" ? [200, "abc"] : [404, "<Error/>"],
    );
    const bucket = createBucket(options(endpoint));
    expect(Buffer.from((await bucket.get("there"))!).toString()).toBe("abc");
    expect(await bucket.get("gone")).toBeNull();
  });

  it("throws on a refusal, naming the operation and status but never the secret", async () => {
    const { endpoint } = await standIn(() => [
      403,
      "<Error><Code>SignatureDoesNotMatch</Code></Error>",
    ]);
    const error = await createBucket(options(endpoint))
      .put("k", new Uint8Array())
      .catch((e: unknown) => e as Error);
    expect(String(error)).toMatch(/put.*403/);
    expect(String(error)).not.toContain("secret-never-logged");
  });
});
