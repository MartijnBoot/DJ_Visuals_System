// Object Storage through its S3-compatible API (B-12 SD10, PD25): SigV4 on node:crypto,
// path-style addressing (`<endpoint>/<bucket>/<key>`), a 10 s timeout per request, no SDK and no
// XML library. Oracle's compatibility API lists ListObjects (v1), not ListObjectsV2, so the list
// is v1 with a prefix; its answer is read for its `<Key>` elements only. Errors name the
// operation and the status, never a key or the secret.
import { createHash, createHmac } from "node:crypto";

export interface SignInput {
  method: string;
  /** The canonical URI, already encoded. */
  path: string;
  query: readonly (readonly [string, string])[];
  /** Lower-case names; every one is signed. */
  headers: Record<string, string>;
  /** Hex SHA-256 of the body. */
  payloadHash: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface Signed {
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
  authorization: string;
}

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) =>
  createHmac("sha256", key).update(data).digest();

/** RFC 3986 percent-encoding, as SigV4 requires: unreserved characters stay, all else escapes. */
export const encodeRfc3986 = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** AWS Signature Version 4 over a request whose `x-amz-date` header is set. */
export function signV4(input: SignInput): Signed {
  const amzDate = input.headers["x-amz-date"];
  if (!amzDate) throw new Error("x-amz-date is required");
  const day = amzDate.slice(0, 8);
  const names = Object.keys(input.headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${input.headers[n]!.trim()}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalQuery = input.query
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)] as const)
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalRequest = [
    input.method,
    input.path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  let key = hmac(`AWS4${input.secretAccessKey}`, day);
  for (const part of [input.region, input.service, "aws4_request"]) key = hmac(key, part);
  const signature = createHmac("sha256", key).update(stringToSign).digest("hex");
  return {
    canonicalRequest,
    stringToSign,
    signature,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/** The keys of a ListObjects answer, XML entities unescaped. */
export function listKeys(xml: string): string[] {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&apos;": "'",
  };
  return [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) =>
    m[1]!.replace(/&(amp|lt|gt|quot|apos);/g, (e) => entities[e]!),
  );
}

export interface BucketOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  fetch: typeof fetch;
  now(): number;
}

export interface Bucket {
  put(key: string, body: Uint8Array): Promise<void>;
  /** The object's bytes, or null when it does not exist. */
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  /** Every key under `prefix` (one page, up to 1000: the routine keeps 14). */
  list(prefix: string): Promise<string[]>;
}

export class BucketError extends Error {
  constructor(operation: string, status: number | null) {
    super(
      status === null ? `bucket ${operation} failed` : `bucket ${operation} answered ${status}`,
    );
    this.name = "BucketError";
  }
}

const TIMEOUT_MS = 10_000;

export function createBucket(options: BucketOptions): Bucket {
  const base = new URL(options.endpoint);
  const basePath = base.pathname.replace(/\/$/, "");

  async function request(
    operation: string,
    method: string,
    key: string | null,
    query: [string, string][] = [],
    body: Uint8Array = new Uint8Array(),
  ): Promise<Response> {
    const path =
      `${basePath}/${encodeRfc3986(options.bucket)}` +
      (key === null ? "" : `/${key.split("/").map(encodeRfc3986).join("/")}`);
    const amzDate = new Date(options.now()).toISOString().replace(/[-:]|\.\d{3}/g, "");
    const payloadHash = sha256(body);
    const headers = {
      host: base.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    const { authorization } = signV4({
      method,
      path,
      query,
      headers,
      payloadHash,
      region: options.region,
      service: "s3",
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    });
    const search = query.map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`).join("&");
    let response: Response;
    try {
      response = await options.fetch(`${base.origin}${path}${search ? `?${search}` : ""}`, {
        method,
        headers: {
          "x-amz-content-sha256": payloadHash,
          "x-amz-date": amzDate,
          authorization,
        },
        ...(method === "PUT" ? { body } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new BucketError(operation, null);
    }
    return response;
  }

  const ensure = async (operation: string, response: Response, allow: number[] = []) => {
    if (response.ok || allow.includes(response.status)) return;
    await response.body?.cancel();
    throw new BucketError(operation, response.status);
  };

  return {
    async put(key, body) {
      const response = await request("put", "PUT", key, [], body);
      await ensure("put", response);
      await response.body?.cancel();
    },
    async get(key) {
      const response = await request("get", "GET", key);
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      await ensure("get", response);
      return new Uint8Array(await response.arrayBuffer());
    },
    async delete(key) {
      const response = await request("delete", "DELETE", key);
      await ensure("delete", response, [404]);
      await response.body?.cancel();
    },
    async list(prefix) {
      const response = await request("list", "GET", null, [["prefix", prefix]]);
      await ensure("list", response);
      return listKeys(await response.text());
    },
  };
}
