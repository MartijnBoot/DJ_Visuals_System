// B-12 T7 (SD15, AC26; the spec's third invariant): the refresh token lives only under
// DATA_DIR/cloud/. Git ignores the folder's default location, and only the session store names
// the session file in the server's source, so nothing else can read it and serve or log it (the
// `tls-boundary` pattern).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");
const store = "server/src/cloud/session-store.ts";

describe("cloud boundary (B-12 SD15)", () => {
  it("git ignores data/cloud/session.json", () => {
    // Throws (exit 1) when the path is not ignored.
    const out = execFileSync("git", ["check-ignore", "data/cloud/session.json"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(out.trim()).toBe("data/cloud/session.json");
  });

  it("no server source but the session store names session.json", () => {
    const files = execFileSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "server/src"],
      { cwd: repoRoot, encoding: "utf8" },
    )
      .split("\0")
      .filter((f) => /\.(ts|js)$/.test(f) && !/\.test\.ts$/.test(f));
    expect(files).toContain(store);
    const naming = files.filter((f) =>
      readFileSync(resolve(repoRoot, f), "utf8").includes("session.json"),
    );
    expect(naming).toEqual([store]);
  });
});
