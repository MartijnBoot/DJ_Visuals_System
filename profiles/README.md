# Authored profiles

Profiles written in a Claude Code session with `/profile` (B-03 spec SD6, SD11), committed here so
a look can be re-made from a fresh clone and its source.

- `<slug>.json` — the profile in the export format (`formatVersion` 2 when it holds a custom
  effect). The owner imports it in `/builder` (Import a file; a profile of the same name can be
  replaced in place). Nothing here is read by the app or written to its database by an agent.
- `<slug>.md` — the notes: what the look was drawn from (title, artist or source, a link where
  there is one) and what was taken from it (palette, motion, texture, the idea).
- `.check/` — the stills `pnpm profile:check` writes; ignored by git.

The inspiration itself (images, references) stays in `inspiration/<slug>/` on the owner's machine,
ignored by git: no third-party image or personal photo is committed.

Custom effects are written against [docs/custom-effects.md](../docs/custom-effects.md).
