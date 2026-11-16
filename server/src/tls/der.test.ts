// T2 (B-06 spec SD5): the DER encoder, byte for byte against hand-checked encodings.
import { describe, expect, it } from "vitest";
import {
  bitString,
  boolean,
  explicit,
  implicit,
  integer,
  octetString,
  oid,
  sequence,
  set,
  time,
  utf8,
} from "./der.ts";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

describe("definite lengths", () => {
  it.each([
    [0, "00"],
    [127, "7f"],
    [128, "8180"],
    [255, "81ff"],
    [256, "820100"],
    [65_535, "82ffff"],
    [65_536, "83010000"],
  ])("a content of %i bytes has the length %s", (size, length) => {
    const encoded = octetString(Buffer.alloc(size, 0xab));
    expect(hex(encoded.subarray(0, 1 + length.length / 2))).toBe(`04${length}`);
    expect(encoded.length).toBe(1 + length.length / 2 + size);
  });
});

describe("integer", () => {
  it("encodes small numbers in the fewest bytes", () => {
    expect(hex(integer(0))).toBe("020100");
    expect(hex(integer(2))).toBe("020102");
    expect(hex(integer(127))).toBe("02017f");
  });

  it("gives a number or bytes with the top bit set a leading zero", () => {
    expect(hex(integer(128))).toBe("02020080");
    expect(hex(integer(Buffer.from([0xff, 0x01])))).toBe("020300ff01");
  });

  it("drops redundant leading zero bytes", () => {
    expect(hex(integer(Buffer.from([0x00, 0x00, 0x7f])))).toBe("02017f");
    expect(hex(integer(Buffer.from([0x00, 0x80])))).toBe("02020080");
    expect(hex(integer(Buffer.from([0x00, 0x00])))).toBe("020100");
  });
});

describe("oid", () => {
  it("encodes the first two arcs together and the rest in base 128", () => {
    expect(hex(oid("2.5.4.3"))).toBe("0603550403");
    expect(hex(oid("1.2.840.10045.4.3.2"))).toBe("06082a8648ce3d040302");
    expect(hex(oid("1.3.6.1.5.5.7.3.1"))).toBe("06082b06010505070301");
  });
});

describe("strings, booleans, bits", () => {
  it("utf8 is tag 0x0c with the bytes", () => {
    expect(hex(utf8("DJ é"))).toBe("0c05444a20c3a9");
  });

  it("boolean is 0xff for true and 0x00 for false", () => {
    expect(hex(boolean(true))).toBe("0101ff");
    expect(hex(boolean(false))).toBe("010100");
  });

  it("bitString carries its unused-bit count first", () => {
    expect(hex(bitString(Buffer.from([0x06]), 1))).toBe("03020106");
    expect(hex(bitString(Buffer.from([1, 2])))).toBe("0303000102");
  });
});

describe("constructed", () => {
  it("sequence and set wrap their items in order", () => {
    expect(hex(sequence(boolean(true), integer(1)))).toBe("30060101ff020101");
    expect(hex(set(integer(1)))).toBe("3103020101");
    expect(hex(sequence())).toBe("3000");
  });

  it("explicit wraps in a constructed context tag, implicit replaces the tag", () => {
    expect(hex(explicit(0, integer(2)))).toBe("a003020102");
    expect(hex(explicit(3, sequence()))).toBe("a3023000");
    expect(hex(implicit(7, Buffer.from([192, 168, 1, 5])))).toBe("8704c0a80105");
    expect(hex(implicit(0, Buffer.from([0xaa])))).toBe("8001aa");
  });
});

describe("time", () => {
  it("is UTCTime before 2050", () => {
    const encoded = time(new Date("2026-11-16T09:05:03.999Z"));
    expect(encoded[0]).toBe(0x17);
    expect(Buffer.from(encoded.subarray(2)).toString("ascii")).toBe("261116090503Z");
  });

  it("is GeneralizedTime from 2050 on", () => {
    const encoded = time(new Date("2050-01-01T00:00:00Z"));
    expect(encoded[0]).toBe(0x18);
    expect(Buffer.from(encoded.subarray(2)).toString("ascii")).toBe("20500101000000Z");
  });

  it("is UTCTime at the last second of 2049", () => {
    const encoded = time(new Date("2049-12-31T23:59:59Z"));
    expect(encoded[0]).toBe(0x17);
    expect(Buffer.from(encoded.subarray(2)).toString("ascii")).toBe("491231235959Z");
  });
});
