---
description: Author one visual profile, with its own shader code, from an inspiration
argument-hint: "[slug, e.g. starry] [what to draw from, optional]"
---

Author **one** profile from an inspiration (B-03 spec SD6, SD7, SD11, SD14). The slug is **$1**;
if none is given, ask for one (lowercase letters, digits and hyphens). Make more than one profile
only when the owner asks for variations.

The look reaches the app only as a file the owner imports. **Never** write to the database, never
touch anything under `data/` or a SQLite file, never call the running server — not to read, not
to write. You write two files and run one script; the owner does the rest.

## 1. Gather the inspiration

- Put everything you are given or find (images, notes, links) in `inspiration/$1/`. That folder is
  ignored by git: it stays on the owner's machine. Never commit a third-party image or a personal
  photo, and never move one out of `inspiration/`.
- Look at it properly: the palette (pick 2 to 6 colours as `#rrggbb`), the motion, the texture,
  the idea a viewer should feel.

## 2. Write the notes: `profiles/$1.md`

- Title; artist or source; a link where there is one.
- What you took from it: palette, motion, texture, the idea — a few lines each.
- Enough that someone with a fresh clone and the source could make the look again.

## 3. Write the profile: `profiles/$1.json`

- The export format: `{ "formatVersion": 2, "profiles": [ { ... } ] }` with one profile: `name`,
  `palette`, `dials` (`recognisability`, `reactivity`, 0 to 1), `effects`. An effect may also
  carry `"dj": true` (one effect at most) or `"vj": true` for a fader on `/control`; a file with
  either is `"formatVersion": 3`. Leave both out unless the owner asks: they tick them in the builder.
- Use the built-in effects where they say it already (palette map, smear, grain, mirror, …) and
  `custom` effects for what they cannot. Write every custom effect against
  [docs/custom-effects.md](../../docs/custom-effects.md): its names, its rules (no `#`, no
  `uniform`, balanced braces, at most 8 KB, labels unique), what the engine adds around a body.
- Flag a custom effect `abstraction: true` when it takes the picture away from the camera, so the
  recognisability dial can bring the room back.
- Prefer one to three parameters an owner would want as sliders, with clear names.

## 4. Check it, look at it, iterate

- Run `pnpm profile:check profiles/$1.json` (add `--camera inspiration/$1/<image>` to see it on
  the inspiration itself).
- Exit 1 names the profile, the effect, the field or the compiler's line: fix it and run again.
- Exit 0 writes nine stills per profile under `profiles/.check/$1/` (quiet, kick and hi-hat, at
  dials (0, 0), the starting dials and (1, 1)). **Read them.** Does it look like the inspiration?
  Does the kick show? Does recognisability 0 bring the camera back? Iterate on the file until it
  does.
- If it reports `flash limiter: clipped`, the code tries to flash harder than the app allows: on
  the screen it becomes a pulse. Keep it only if a pulse is what you want.
- Speed is not checked: software WebGL says nothing about the owner's GPU. Keep `source` calls and
  loops modest; the builder shows the owner the frame time.

## 5. Finish

- Format the file: `pnpm exec prettier --write profiles/$1.json profiles/$1.md`.
- `git status` should show `profiles/$1.json` and `profiles/$1.md` as the only new files.
- Tell the owner: open `/builder`, **Import a file**, choose `profiles/$1.json`. When a profile of
  that name is already stored (an earlier version), **Replace** keeps its id, so the screen page
  and paired controllers stay on it.
- Commit only when the owner asks.
