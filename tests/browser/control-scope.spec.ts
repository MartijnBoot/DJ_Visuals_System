// B-19 (spec SD8, AC22; plan PD12, T2): the controller's new look stays on `/control`. `/send`
// keeps today's look exactly, pinned here by computed style on the LAN listener — one property or
// more for each style key the page uses (page, column, heading, row, input, button, linkLine,
// note) — before and after it stops sharing the controller's style module.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { LAN_CONTEXT, startControlServer, type ControlServer } from "./control-server.ts";
import { remote, type Remote } from "./remote-fixtures.ts";

let server: ControlServer;
let r: Remote;
const closing: (() => Promise<void>)[] = [];

test.beforeEach(async () => {
  server = await startControlServer();
  r = remote(server);
});

test.afterEach(async () => {
  for (const close of closing.splice(0)) await close();
  await r.dispose();
  await server.dispose();
});

const css = (locator: Locator, properties: string[]) =>
  locator.evaluate((el, props) => {
    const style = getComputedStyle(el);
    return Object.fromEntries(props.map((p) => [p, style.getPropertyValue(p)]));
  }, properties);

async function lanPage(page: Page, path: string): Promise<Page> {
  const context = await page
    .context()
    .browser()!
    .newContext({ ...LAN_CONTEXT });
  closing.push(() => context.close());
  const opened = await context.newPage();
  await opened.goto(`${server.lanOrigin}${path}`);
  return opened;
}

test("/send keeps today's look: page, column, heading, row, input, button, link line and note (AC22, SD8)", async ({
  page,
}) => {
  const { code } = await r.screen(page);
  const sender = await lanPage(page, "/send");
  const input = sender.getByTestId("send-code");
  await expect(input).toBeVisible();

  expect(
    await css(sender.getByTestId("sender"), ["background-color", "color", "font-size"]),
  ).toEqual({
    "background-color": "rgb(17, 17, 17)",
    color: "rgb(255, 255, 255)",
    "font-size": "16px",
  });
  expect(
    await css(sender.getByTestId("sender").locator("> div"), [
      "padding-top",
      "max-width",
      "row-gap",
    ]),
  ).toEqual({ "padding-top": "12px", "max-width": "900px", "row-gap": "16px" });
  expect(
    await css(sender.getByRole("heading", { name: "Send to the screen" }), [
      "font-size",
      "font-weight",
      "color",
    ]),
  ).toEqual({ "font-size": "14px", "font-weight": "600", color: "rgb(221, 221, 221)" });
  expect(
    await css(sender.locator("label", { has: input }), ["display", "flex-wrap", "column-gap"]),
  ).toEqual({ display: "flex", "flex-wrap": "wrap", "column-gap": "8px" });
  expect(
    await css(input, [
      "border-top-width",
      "border-top-style",
      "border-top-color",
      "min-height",
      "background-color",
      "letter-spacing",
    ]),
  ).toEqual({
    "border-top-width": "1px",
    "border-top-style": "solid",
    "border-top-color": "rgb(119, 119, 119)",
    "min-height": "48px",
    "background-color": "rgb(0, 0, 0)",
    "letter-spacing": "4px",
  });
  expect(
    await css(sender.getByTestId("send-button"), [
      "background-color",
      "min-height",
      "border-top-left-radius",
    ]),
  ).toEqual({
    "background-color": "rgb(42, 42, 42)",
    "min-height": "48px",
    "border-top-left-radius": "8px",
  });

  // Sending shows the link line and the note.
  await input.fill(code);
  await sender.getByTestId("send-button").click();
  const line = sender.getByTestId("link-line");
  await expect(line).toHaveText("Waiting for approval");
  expect(
    await css(line, ["background-color", "font-weight", "border-top-left-radius", "padding-top"]),
  ).toEqual({
    "background-color": "rgb(34, 34, 34)",
    "font-weight": "600",
    "border-top-left-radius": "8px",
    "padding-top": "10px",
  });
  expect(await css(sender.getByTestId("send-keep"), ["color", "font-size"])).toEqual({
    color: "rgb(204, 204, 204)",
    "font-size": "14px",
  });
});
