// B-12 T7 (SD15, AC24, AC25, PD20): DATA_DIR/cloud/session.json, written atomically, owner-only
// where the OS allows (B-06 T3's Windows answer: the mode is asserted on POSIX only).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSessionStore, type SessionStore } from "./session-store.ts";

let dataDir: string;
let store: SessionStore;
const file = () => join(dataDir, "cloud", "session.json");

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "djv-session-"));
  store = createSessionStore(dataDir);
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

describe("the session file", () => {
  it("reads none before anything is written, without creating the folder", () => {
    expect(store.read()).toEqual({ kind: "none" });
  });

  it("writes, reads, revokes and removes", () => {
    store.write("refresh-1");
    expect(store.read()).toEqual({ kind: "connected", refreshToken: "refresh-1" });
    expect(JSON.parse(readFileSync(file(), "utf8"))).toEqual({ refreshToken: "refresh-1" });
    store.revoke();
    expect(store.read()).toEqual({ kind: "revoked" });
    expect(readFileSync(file(), "utf8")).not.toContain("refresh-1");
    store.remove();
    expect(store.read()).toEqual({ kind: "none" });
    store.remove(); // a second remove is fine
  });

  it("reads a malformed file as none", () => {
    mkdirSync(join(dataDir, "cloud"), { recursive: true });
    for (const text of ["{nope", "[]", '{"refreshToken": 5}', '{"revoked": false}']) {
      writeFileSync(file(), text);
      expect(store.read()).toEqual({ kind: "none" });
    }
  });

  it("a torn temp file never replaces a good one", () => {
    store.write("good");
    // A crash mid-write leaves a temp file; a later read ignores it.
    writeFileSync(`${file()}.999999.tmp`, '{"refreshTo');
    expect(store.read()).toEqual({ kind: "connected", refreshToken: "good" });
    // A write that cannot finish its temp file leaves the good file as it was.
    mkdirSync(`${file()}.${process.pid}.tmp`);
    expect(() => store.write("new")).toThrow();
    expect(store.read()).toEqual({ kind: "connected", refreshToken: "good" });
  });

  it.skipIf(process.platform === "win32")("is owner-only: the file 0o600, the folder 0o700", () => {
    store.write("refresh-1");
    expect(statSync(file()).mode & 0o777).toBe(0o600);
    expect(statSync(join(dataDir, "cloud")).mode & 0o777).toBe(0o700);
  });
});
