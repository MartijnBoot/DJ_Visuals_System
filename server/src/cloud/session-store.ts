// DATA_DIR/cloud/session.json (B-12 SD15, PD20): the local install's refresh token, or the mark
// that it was revoked. The only module that names the file (tests/meta/cloud-boundary.test.ts).
// Written to a temp file and renamed over the old one, so a crash mid-write never leaves half a
// file in its place; owner-only where the OS allows (B-06 T3: on Windows the mode does not reach
// the ACL). Never served and never logged.
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type SessionFile =
  { kind: "none" } | { kind: "connected"; refreshToken: string } | { kind: "revoked" };

export interface SessionStore {
  /** The file as it is; missing or malformed reads as none. */
  read(): SessionFile;
  write(refreshToken: string): void;
  /** Keeps "signed out" across restarts, without the token (PD20). */
  revoke(): void;
  remove(): void;
}

export function createSessionStore(dataDir: string): SessionStore {
  const dir = join(dataDir, "cloud");
  const file = join(dir, "session.json");

  const save = (content: object) => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(content), { mode: 0o600 });
    chmodSync(temp, 0o600); // an existing file keeps its mode on write
    renameSync(temp, file);
  };

  return {
    read() {
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        return { kind: "none" };
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return { kind: "none" };
      }
      const { refreshToken, revoked } = parsed as Record<string, unknown>;
      if (revoked === true) return { kind: "revoked" };
      if (typeof refreshToken === "string" && refreshToken.length > 0) {
        return { kind: "connected", refreshToken };
      }
      return { kind: "none" };
    },
    write: (refreshToken) => save({ refreshToken }),
    revoke: () => save({ revoked: true }),
    remove: () => rmSync(file, { force: true }),
  };
}
