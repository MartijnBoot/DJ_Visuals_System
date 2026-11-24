// B-19 (spec SD8, SD12, AC22, AC23; plan PD2, PD12, T2, T8): the controller's new look stays on
// `/control`. `/send` keeps today's look exactly, pinned here by computed style on the LAN
// listener — one property or more for each style key the page uses (page, column, heading, row,
// input, button, linkLine, note) — before and after it stops sharing the controller's style
// module. No other route holds an element or a rule of the look, and `/control` requests nothing
// new.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { LAN_CONTEXT, startControlServer, type ControlServer } from "./control-server.ts";
import { remote, type Remote } from "./remote-fixtures.ts";
import { setFader } from "./fader.ts";

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

// T8 (spec AC22, AC23): no route but `/control` holds a rule of the controller's look, and
// `/control` asks for nothing new.

/** Elements under `.djv-control`, and stylesheet rules that name it, in the page as loaded. */
const lookIn = (opened: Page) =>
  opened.evaluate(() => {
    const rules: string[] = [];
    const walk = (list: CSSRuleList) => {
      for (const rule of Array.from(list)) {
        if (rule.cssText.includes("djv-control")) rules.push(rule.cssText.slice(0, 80));
        if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) walk(sheet.cssRules);
    return { elements: document.querySelectorAll(".djv-control").length, rules };
  });

test("/, /builder, /send and /trust hold no element and no rule of the controller's look (AC22)", async ({
  page,
}) => {
  await r.screen(page);
  await expect(page.getByTestId("control-switch")).toBeChecked();
  expect(await lookIn(page), "/").toEqual({ elements: 0, rules: [] });

  const builder = await (await page.context().browser()!.newContext()).newPage();
  closing.push(() => builder.context().close());
  await builder.goto(`${server.origin}/builder`);
  await expect(builder.locator("#root > *").first()).toBeVisible();
  expect(await lookIn(builder), "/builder").toEqual({ elements: 0, rules: [] });

  for (const path of ["/send", "/trust"]) {
    const opened = await lanPage(page, path);
    await expect(opened.locator("body > *").first()).toBeVisible();
    expect(await lookIn(opened), path).toEqual({ elements: 0, rules: [] });
  }

  // And `/control` itself does hold them: the check can see the look where it is.
  const control = await lanPage(page, "/control");
  await expect(control.getByTestId("controller")).toBeVisible();
  const own = await lookIn(control);
  expect(own.elements).toBe(1);
  expect(own.rules.length).toBeGreaterThan(10);
});

test("a paired /control through pairing, a tile, both faders, the wheel and a turn requests only /control, /assets/* and the device socket (AC23)", async ({
  page,
}) => {
  const { url } = await r.screen(page);
  const context = await page
    .context()
    .browser()!
    .newContext({ ...LAN_CONTEXT, viewport: { width: 320, height: 568 } });
  closing.push(() => context.close());
  const requests: string[] = [];
  context.on("request", (req) => requests.push(`${req.method()} ${new URL(req.url()).pathname}`));
  const phone = await context.newPage();
  phone.on("websocket", (ws) => requests.push(`WS ${new URL(ws.url()).pathname}`));

  await phone.goto(url);
  await expect(phone.getByTestId("link-line")).toHaveText("Waiting for approval");
  await page.getByTestId("control-accept").click();
  await expect(phone.getByTestId("link-line")).toHaveText("Connected");
  const tile = phone.getByTestId("profile-tile").first();
  await tile.click();
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  await setFader(phone.getByTestId("dial-recognisability"), 0.6);
  await setFader(phone.getByTestId("dial-reactivity"), 0.4);
  await phone.getByTestId("wheel-disc").focus();
  await phone.keyboard.press("ArrowUp");
  await phone.getByTestId("wheel-brightness").focus();
  await phone.keyboard.press("PageDown");
  await phone.setViewportSize({ width: 568, height: 320 });
  await expect(phone.getByTestId("dial-recognisability")).toHaveAttribute(
    "aria-orientation",
    "vertical",
  );
  await phone.waitForTimeout(500);

  expect(requests).toContain("GET /control");
  expect(requests).toContain("WS /api/control/device");
  expect(
    requests.filter(
      (r) => !/^(GET \/control|GET \/assets\/[^/]+|WS \/api\/control\/device)$/.test(r),
    ),
  ).toEqual([]);
});
