// What the B-06 browser specs after T13 share (plan T15, T16, T19): the screen page with External
// control on, LAN contexts closed after each test, scripted senders and real `/control` pages
// paired from the panel, and the newest screen state a scripted controller holds. Every wait is on
// a state a page or a message shows, never a fixed time.
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { ScreenState } from "../../shared/src/control.ts";
import {
  deviceClient,
  LAN_CONTEXT,
  type ControlServer,
  type DeviceClient,
} from "./control-server.ts";
import { record } from "./helpers.ts";
import { senderClient, type SenderClient } from "./sender-client.ts";

export const PHONE = { width: 390, height: 844 };

export type Sends = ("video" | "audio")[];

export interface Remote {
  /** Opens the screen page and switches External control on; the code and the `/control` URL. */
  screen(page: Page): Promise<{ code: string; url: string }>;
  /** A scripted sender, requested with the code; not yet accepted. */
  sender(page: Page, code: string, sends: Sends): Promise<SenderClient>;
  /** A scripted sender accepted from the panel. */
  pairedSender(
    page: Page,
    code: string,
    sends: Sends,
  ): Promise<{ sender: SenderClient; deviceId: string }>;
  /** A scripted controller accepted from the panel. */
  pairedController(page: Page, code: string): Promise<DeviceClient>;
  /** The real `/control` page from the QR URL, accepted from the panel. */
  phone(page: Page, browser: Browser, url: string): Promise<Page>;
  dispose(): Promise<void>;
}

export function remote(server: ControlServer): Remote {
  const contexts: BrowserContext[] = [];
  const lanContext = async (browser: Browser, options = {}) => {
    const context = await browser.newContext({ ...LAN_CONTEXT, ...options });
    contexts.push(context);
    return context;
  };
  const accept = async (page: Page) => {
    const button = page.getByTestId("control-accept");
    await expect(button).toHaveCount(1);
    await button.click();
    await expect(button).toHaveCount(0);
  };
  const self: Remote = {
    async screen(page) {
      await record(page);
      await page.goto(`${server.origin}/`);
      await page.getByTestId("control-switch").click();
      await expect(page.getByTestId("control-switch")).toBeChecked();
      return {
        code: (await page.getByTestId("control-code").textContent()) ?? "",
        url: (await page.getByTestId("control-url").textContent()) ?? "",
      };
    },
    async sender(page, code, sends) {
      const sender = await senderClient(await lanContext(page.context().browser()!), server, sends);
      await sender.request(code);
      return sender;
    },
    async pairedSender(page, code, sends) {
      const sender = await self.sender(page, code, sends);
      await accept(page);
      const { deviceId } = await sender.waitFor("approved");
      return { sender, deviceId };
    },
    async pairedController(page, code) {
      const controller = await deviceClient(await lanContext(page.context().browser()!), server);
      await controller.send({ type: "hello", code });
      await controller.waitFor("waiting");
      await accept(page);
      await controller.waitFor("approved");
      return controller;
    },
    async phone(page, browser, url) {
      const phone = await (await lanContext(browser, { viewport: PHONE })).newPage();
      await phone.goto(url);
      await expect(phone.getByTestId("link-line")).toHaveText("Waiting for approval");
      await accept(page);
      await expect(phone.getByTestId("profile-tile").first()).toBeEnabled();
      return phone;
    },
    async dispose() {
      for (const c of contexts.splice(0)) await c.close();
    },
  };
  return self;
}

/** The newest state the controller holds, once `pred` holds for it. */
export async function stateWhere(controller: DeviceClient, pred: (s: ScreenState) => boolean) {
  let found: ScreenState | null = null;
  await expect
    .poll(
      async () => {
        const states = (await controller.messages()).flatMap((m) =>
          m.type === "state" ? [m.state] : [],
        );
        found = states.at(-1) ?? null;
        return found !== null && pred(found);
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return found!;
}
