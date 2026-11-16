// A DER encoder (B-06 spec SD5): exactly the primitives two certificate shapes need — the local
// root and the server certificate (`certificate.ts`). Definite lengths of any size; no decoding.
// Every function returns the whole TLV (tag, length, content) as a Buffer.

function length(size: number): Buffer {
  if (size < 0x80) return Buffer.from([size]);
  const bytes: number[] = [];
  for (let rest = size; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, content: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from([tag]), length(content.length), content]);
}

export const sequence = (...items: Uint8Array[]) => tlv(0x30, Buffer.concat(items));
export const set = (...items: Uint8Array[]) => tlv(0x31, Buffer.concat(items));

/** A non-negative integer: a safe number, or unsigned big-endian bytes (a serial). */
export function integer(value: number | Uint8Array): Buffer {
  let bytes: Buffer;
  if (typeof value === "number") {
    const digits: number[] = [];
    for (let rest = value; rest > 0; rest = Math.floor(rest / 256)) digits.unshift(rest % 256);
    bytes = Buffer.from(digits);
  } else {
    bytes = Buffer.from(value);
  }
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
  bytes = bytes.subarray(start);
  if (bytes.length === 0) bytes = Buffer.from([0]);
  if (bytes[0]! & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return tlv(0x02, bytes);
}

export function oid(dotted: string): Buffer {
  const [first, second, ...rest] = dotted.split(".").map(Number);
  const arcs = [first! * 40 + second!, ...rest];
  const bytes: number[] = [];
  for (const arc of arcs) {
    const groups = [arc % 128];
    for (let high = Math.floor(arc / 128); high > 0; high = Math.floor(high / 128)) {
      groups.unshift(0x80 | (high % 128));
    }
    bytes.push(...groups);
  }
  return tlv(0x06, Buffer.from(bytes));
}

export const utf8 = (text: string) => tlv(0x0c, Buffer.from(text, "utf8"));
export const boolean = (value: boolean) => tlv(0x01, Buffer.from([value ? 0xff : 0x00]));
export const octetString = (bytes: Uint8Array) => tlv(0x04, bytes);
export const bitString = (bytes: Uint8Array, unusedBits = 0) =>
  tlv(0x03, Buffer.concat([Buffer.from([unusedBits]), bytes]));

/** UTCTime before 2050, GeneralizedTime from it (RFC 5280 4.1.2.5); whole seconds, UTC. */
export function time(date: Date): Buffer {
  const iso = date.toISOString(); // 2026-11-16T09:05:03.999Z
  const digits = iso.slice(0, 19).replace(/[-T:]/g, ""); // 20261116090503
  const year = date.getUTCFullYear();
  return year < 2050
    ? tlv(0x17, Buffer.from(`${digits.slice(2)}Z`, "ascii"))
    : tlv(0x18, Buffer.from(`${digits}Z`, "ascii"));
}

/** A constructed context-specific tag around a whole element: `[n] EXPLICIT`. */
export const explicit = (n: number, inner: Uint8Array) => tlv(0xa0 | n, inner);
/** A primitive context-specific tag in place of the element's own: `[n] IMPLICIT`. */
export const implicit = (n: number, content: Uint8Array) => tlv(0x80 | n, content);
