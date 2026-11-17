// B-12 T13 (AC7, AC10, AC14, AC19, AC24, AC25, SD13; plan PD3, PD4, PD18): the panel's cloud row
// and the builder's conflict copies, on a local install booted in this process with cloud
// settings, against the in-process hosted cloud and the fake issuer (`hosted-server.ts`).
import { expect, test, type Page } from "@playwright/test";
import { start } from "./helpers.ts";
import {
  startHostedCloud,
  startLocalWithCloud,
  type HostedCloud,
  type TestServer,
} from "./hosted-server.ts";

let hosted: HostedCloud;
let local: TestServer;

const look = (name: string, shade = "#444444") => ({
  name,
  palette: ["#000000", shade, "#ffffff"],
  dials: { recognisability: 0.5, reactivity: 0.5 },
  effects: [{ type: "paletteMap", amount: 1 }],
});

test.beforeEach(async () => {
  hosted = await startHostedCloud();
  local = await startLocalWithCloud(hosted.cloud.origin, hosted.issuer);
});

test.afterEach(async () => {
  await local?.dispose();
  await hosted?.dispose();
});

const line = (page: Page) => page.getByTestId("cloud-line");

/** Closes and opens the panel: the row reads the status again (PD18). */
async function reopen(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("s");
  await expect(page.getByTestId("panel")).toHaveCount(0);
  await page.keyboard.press("s");
  await expect(page.getByTestId("panel")).toBeVisible();
}

/** The panel never scrolls sideways (D-05). */
async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page
    .getByTestId("panel")
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** "Connect to cloud" → the provider in a new tab → back on the panel, connected (AC24). */
async function connect(page: Page) {
  await page.goto(`${local.origin}/`);
  await expect(line(page)).toHaveText("cloud: Not connected");
  const popup = page.waitForEvent("popup");
  await page.getByTestId("cloud-connect").click();
  const tab = await popup;
  await expect(tab.locator("body")).toContainText(
    "Connected to the cloud — you can close this tab",
  );
  await tab.close();
  await page.bringToFront();
  await expect(async () => {
    if (!/Last synced \d\d:\d\d/.test((await line(page).textContent()) ?? "")) {
      await reopen(page);
    }
    await expect(line(page)).toHaveText(/^cloud: Last synced \d\d:\d\d$/, { timeout: 2000 });
  }).toPass({ timeout: 15_000 });
}

async function localApi(page: Page, method: string, path: string, body?: unknown) {
  const response = await page.request.fetch(`${local.origin}${path}`, {
    method,
    ...(body === undefined ? {} : { data: body }),
  });
  return { status: response.status(), body: (await response.json().catch(() => null)) as unknown };
}

test("Connect to cloud signs in through the provider and the row shows Connected (AC24)", async ({
  page,
}) => {
  await connect(page);
  await expect(page.getByTestId("cloud-sync-now")).toBeVisible();
  await expect(page.getByTestId("cloud-disconnect")).toBeVisible();
  await expectNoSidewaysScroll(page);
});

test("Sync now while a set runs is refused with the reason and asks the cloud nothing (AC10)", async ({
  page,
}) => {
  await connect(page);
  await start(page);
  await expect(line(page)).toHaveText("cloud: A set is running — sync resumes when it stops");
  const asked = () => hosted.cloud.lines.filter((l) => l.includes('"url":"/api/sync/')).length;
  const before = asked();
  await page.getByTestId("cloud-sync-now").click();
  await expect(page.getByTestId("cloud-note")).toHaveText(
    "A set is running — sync resumes when it stops",
  );
  await page.waitForTimeout(3000);
  expect(asked()).toBe(before);
  await expectNoSidewaysScroll(page);
});

test("with the cloud stopped, a save shows Offline — changes will sync on the next open (AC7)", async ({
  page,
}) => {
  await connect(page);
  await hosted.cloud.close();
  expect((await localApi(page, "POST", "/api/profiles", look("Offline edit"))).status).toBe(201);
  await expect(async () => {
    await reopen(page);
    await expect(line(page)).toHaveText("cloud: Offline — changes will sync", { timeout: 2000 });
  }).toPass({ timeout: 20_000 });
});

test("a conflict shows 1 conflicts kept as copies and the builder's Conflict copy, gone after a rename (AC14, PD3)", async ({
  page,
}) => {
  await connect(page);
  const created = await localApi(page, "POST", "/api/profiles", look("Shared"));
  const id = (created.body as { id: string }).id;
  await page.getByTestId("cloud-sync-now").click();
  await expect(line(page)).toHaveText(/^cloud: Last synced/);
  // The cloud's copy changes, then this machine's.
  const token = hosted.issuer.token();
  const onCloud = await page.request.get(`${hosted.cloud.origin}/api/profiles/${id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const cloudRevision = ((await onCloud.json()) as { revision: number }).revision;
  const cloudEdit = await page.request.put(`${hosted.cloud.origin}/api/profiles/${id}`, {
    headers: { authorization: `Bearer ${token}` },
    data: { ...look("Shared", "#aa0000"), revision: cloudRevision },
  });
  expect(cloudEdit.status()).toBe(200);
  const mine = (await localApi(page, "GET", `/api/profiles/${id}`)).body as { revision: number };
  expect(
    (
      await localApi(page, "PUT", `/api/profiles/${id}`, {
        ...look("Shared", "#00bb00"),
        revision: mine.revision,
      })
    ).status,
  ).toBe(200);
  await page.getByTestId("cloud-sync-now").click();
  await expect(page.getByTestId("cloud-conflicts")).toHaveText("1 conflicts kept as copies");
  await expectNoSidewaysScroll(page);

  await page.getByTestId("cloud-conflicts").click();
  await expect(page).toHaveURL(`${local.origin}/builder`);
  await expect(page.getByTestId("conflict-line")).toHaveText("1 conflicts kept as copies");
  const copy = page.locator('[data-testid^="conflict-copy-"]');
  await expect(copy).toHaveCount(1);
  await expect(copy).toHaveText("Conflict copy");
  const copyId = (await copy.getAttribute("data-testid"))!.replace("conflict-copy-", "");
  await page.getByTestId(`profile-rename-${copyId}`).click();
  await page.getByTestId("rename-input").fill("Mine, kept");
  await page.getByTestId("rename-save").click();
  await expect(page.getByTestId(`profile-name-${copyId}`)).toHaveText("Mine, kept");
  await expect(copy).toHaveCount(0);
  await expect(page.getByTestId("conflict-line")).toHaveCount(0);
});

test("a refused renewal shows Sign in again; the app keeps working (AC25)", async ({ page }) => {
  await connect(page);
  hosted.issuer.refuseRefresh = true;
  await local.close();
  await local.restart(); // the boot sync's renewal is refused
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId("cloud-sign-in-again")).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.getByTestId("cloud-sync-now")).toHaveCount(0);
  expect((await localApi(page, "GET", "/api/profiles")).status).toBe(200);
});

test("Disconnect from cloud asks first, then leaves every profile in place (AC24)", async ({
  page,
}) => {
  await connect(page);
  await localApi(page, "POST", "/api/profiles", look("Stays"));
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.getByTestId("cloud-disconnect").click();
  await expect(page.getByTestId("cloud-sync-now")).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByTestId("cloud-disconnect").click();
  await expect(line(page)).toHaveText("cloud: Not connected");
  const list = (await localApi(page, "GET", "/api/profiles")).body as { profiles: unknown[] };
  expect(list.profiles).toHaveLength(1);
});

test("the gate's own server, with no cloud settings, shows no cloud row and asks no /api/cloud (AC19)", async ({
  page,
}) => {
  const asked: string[] = [];
  page.on("request", (r) => asked.push(new URL(r.url()).pathname));
  await page.goto("/");
  await expect(page.getByTestId("panel")).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.getByTestId("cloud-row")).toHaveCount(0);
  expect(asked.filter((p) => p.startsWith("/api/cloud"))).toEqual([]);
});
