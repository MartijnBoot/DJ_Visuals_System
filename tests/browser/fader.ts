// B-19 (spec SD14; plan PD5, PD7, T4): driving a `/control` fader the way a person does — by its
// keys or by a pointer drag — where the dial tests used `.fill()` and `toHaveValue` on a native
// range. The fader shows the screen's value whenever no pointer holds it, so after each key the
// helper waits for the screen's answer before choosing the next key.
import { expect, type Locator, type Page } from "@playwright/test";

/** The fader's `aria-valuenow`: the screen's value, or the held value during a drag. */
export async function faderValue(fader: Locator): Promise<number> {
  return Number(await fader.getAttribute("aria-valuenow"));
}

/** Key presses from `from` to `to`, both in hundredths, by Page Up/Down then arrows. */
function presses(from: number, to: number): number {
  const d = Math.abs(to - from);
  const tens = Math.floor(d / 10);
  return Math.min(tens + (d - tens * 10), tens + 1 + ((tens + 1) * 10 - d));
}

/** The next key toward `to` from `from` (hundredths): Home or End when shorter, else Page, else arrow. */
function nextKey(from: number, to: number): string {
  const direct = presses(from, to);
  if (to === 0 || 1 + presses(0, to) < direct) return "Home";
  if (to === 100 || 1 + presses(100, to) < direct) return "End";
  const d = to - from;
  const tens = Math.floor(Math.abs(d) / 10);
  const overshoot = tens + 1 + ((tens + 1) * 10 - Math.abs(d)) < tens + (Math.abs(d) - tens * 10);
  if (tens > 0 || overshoot) return d > 0 ? "PageUp" : "PageDown";
  return d > 0 ? "ArrowRight" : "ArrowLeft";
}

/**
 * Sets the fader to `value` (on the 0.01 grid) by keyboard, at most ten presses: each press waits
 * for the fader to show the screen's new value, and the next key is chosen from what it shows.
 */
export async function setFader(fader: Locator, value: number): Promise<void> {
  const to = Math.round(value * 100);
  await fader.focus();
  for (let i = 0; i < 12; i++) {
    const shown = await faderValue(fader);
    const from = Math.round(shown * 100);
    if (from === to) return;
    await fader.press(nextKey(from, to));
    await expect(fader).not.toHaveAttribute("aria-valuenow", String(shown));
  }
  await expect(fader).toHaveAttribute("aria-valuenow", String(to / 100));
}

/**
 * Drags the fader with the mouse: lands at `from` (0 to 1 along the track, from the low end) and
 * moves by `by` × the track's length (negative is less), in `steps` moves. `release: false`
 * leaves the button down.
 */
export async function dragFader(
  page: Page,
  fader: Locator,
  {
    from,
    by,
    steps = 8,
    release = true,
  }: { from: number; by: number; steps?: number; release?: boolean },
): Promise<void> {
  const box = (await fader.boundingBox())!;
  const vertical = (await fader.getAttribute("aria-orientation")) === "vertical";
  const at = (t: number) =>
    vertical
      ? { x: box.x + box.width / 2, y: box.y + box.height * (1 - t) }
      : { x: box.x + box.width * t, y: box.y + box.height / 2 };
  const start = at(from);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const p = at(from + (by * i) / steps);
    await page.mouse.move(p.x, p.y);
  }
  if (release) await page.mouse.up();
}
