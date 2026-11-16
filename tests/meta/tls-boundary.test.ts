// B-06 T3 (spec AC35, SD23): the local CA's private keys stay in `DATA_DIR/tls/`. Git ignores the
// folder's default location, and only the certificate store names a key file in the server's
// source, so nothing else can read one and serve or log it.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");
const store = "server/src/tls/store.ts";

describe("tls boundary (AC35)", () => {
  it("git ignores data/tls/root.key and data/tls/server.key", () => {
    for (const path of ["data/tls/root.key", "data/tls/server.key"]) {
      // Throws (exit 1) when the path is not ignored.
      const out = execFileSync("git", ["check-ignore", path], { cwd: repoRoot, encoding: "utf8" });
      expect(out.trim()).toBe(path);
    }
  });

  it("no server source but the store names a .key file", () => {
    const files = execFileSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "server/src"],
      { cwd: repoRoot, encoding: "utf8" },
    )
      .split("\0")
      .filter((f) => /\.(ts|js)$/.test(f) && !/\.test\.ts$/.test(f));
    expect(files).toContain(store);
    // A string literal ending in `.key` ("root.key", `${name}.key`), not a property (`msg.key`).
    const keyFile = /["'`][^"'`\n]*\.key["'`]/;
    const naming = files.filter((f) => keyFile.test(readFileSync(resolve(repoRoot, f), "utf8")));
    expect(naming).toEqual([store]);
  });
});
