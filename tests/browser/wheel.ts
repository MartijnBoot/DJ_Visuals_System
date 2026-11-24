// B-16 (spec SD7, AC12; plan PD6): driving the pinned wheel's disc by its keys the way the fader
// helpers drive a fader (`fader.ts`). A wheel that is not held shows the screen's last report, so
// in a burst of keys an echo of an earlier key can land after a later one and show for a moment.
// Each press therefore waits for the screen's answer before the next, and what the helper returns
// is a colour the screen has settled on, never one in flight.
import { expect, type Page } from "@playwright/test";

/** Presses `key` on the disc `n` times, one settled press at a time; the screen's final colour. */
export async function discKeys(phone: Page, key: string, n: number): Promise<string> {
  const value = phone.getByTestId("wheel-value");
  const onScreen = phone.getByTestId("wheel-current");
  await phone.getByTestId("wheel-disc").focus();
  for (let i = 0; i < n; i++) {
    await phone.keyboard.press(key);
    await expect(onScreen).toHaveAttribute("data-colour", (await value.textContent())!);
  }
  return (await value.textContent())!;
}
