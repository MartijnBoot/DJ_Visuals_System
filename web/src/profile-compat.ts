// AC19 (B-02 spec SD17; plan PD8): `engine/` and `shared/` each declare `Profile` and `engine/`
// never imports `shared/`; `web/` validates a fetched profile with the shared schema and hands
// it to the engine. These two assignments make `pnpm typecheck` fail the moment the shapes drift
// apart in either direction. `tests/meta/profile-compat.test.ts` proves they do.
import type { Profile as ForEngine } from "@djv/engine";
import type { Profile as FromShared } from "@djv/shared";

export const sharedToEngine = (profile: FromShared): ForEngine => profile;
export const engineToShared = (profile: ForEngine): FromShared => profile;

// B-04 PD16: an optional field declared on one side only still assigns both ways, so the key
// sets must also be equal. A key on one side alone makes its `Missing…` type that key, not
// `never`, and the assignment below fails naming it.
type MissingInEngine = Exclude<keyof FromShared, keyof ForEngine>;
type MissingInShared = Exclude<keyof ForEngine, keyof FromShared>;
export const sameKeys: [MissingInEngine, MissingInShared] extends [never, never]
  ? true
  : { missingInEngine: MissingInEngine; missingInShared: MissingInShared } = true;
