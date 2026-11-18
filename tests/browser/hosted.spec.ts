// B-12 T14 (AC2, AC20–AC23, AC26; spec Verification step 5): hosted use end to end, against the
// in-process hosted cloud serving the built web/dist and the fake issuer (`hosted-server.ts`).
// Every server log line, every console message of every page and every response body read is
// kept, and scanned at the end of each test for the tokens, codes, subject and email the issuer
// handed out (AC26; definitions only in logs and console, PD13).
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { FAKE_EMAIL } from "../../server/test/fake-issuer.ts";
import { startHostedCloud, type HostedCloud } from "./hosted-server.ts";

/** A colour no default carries: a definition reaching a log or the console shows as this. */
const MARKER = "#3c1d2e";

let hosted: HostedCloud | undefined;
const evidence = {
  console: [] as string[],
  bodies: [] as string[],
  reading: [] as Promise<void>[],
};

const look = (name: string) => ({
  name,
  palette: ["#000000", MARKER, "#ffffff"],
  dials: { recognisability: 0.5, reactivity: 0.5 },
  effects: [{ type: "paletteMap", amount: 1 }],
});

async function setup(context: BrowserContext, options: { lifetime?: number } = {}) {
  hosted = await startHostedCloud(options);
  const origin = hosted.cloud.origin;
  evidence.console = [];
  evidence.bodies = [];
  context.on("console", (message) => evidence.console.push(message.text()));
  context.on("weberror", (error) => evidence.console.push(String(error.error())));
  evidence.reading = [];
  context.on("response", (response) => {
    if (!response.url().startsWith(origin)) return;
    if (!/json|html|javascript|text/.test(response.headers()["content-type"] ?? "")) return;
    evidence.reading.push(
      response
        .text()
        .catch(() => "")
        .then((body) => void evidence.bodies.push(body)),
    );
  });
  return hosted;
}

test.afterEach(async () => {
  if (!hosted) return;
  // AC26: nothing secret anywhere, checked to be something before the scan (as
  // remote-e2e.spec.ts does, so an empty list cannot pass).
  const { issued, subject } = hosted.issuer;
  const secrets = [
    ...issued.idTokens,
    ...issued.refreshTokens,
    ...issued.codes,
    subject,
    FAKE_EMAIL,
  ];
  expect(issued.idTokens.length).toBeGreaterThan(0);
  expect(issued.refreshTokens.length).toBeGreaterThan(0);
  expect(issued.codes.length).toBeGreaterThan(0);
  for (const token of issued.idTokens) expect(token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]{40,}$/);
  for (const token of issued.refreshTokens) expect(token).toMatch(/^fake-refresh-[0-9a-f]{32}$/);
  for (const code of issued.codes) expect(code).toMatch(/^fake-code-[0-9a-f]{24}$/);
  expect(subject.length).toBeGreaterThan(8);
  await Promise.all(evidence.reading); // a body still being read is scanned too
  const logs = hosted.cloud.lines;
  for (const text of [...logs, ...evidence.console, ...evidence.bodies]) {
    for (const secret of secrets) expect(text).not.toContain(secret);
  }
  for (const text of [...logs, ...evidence.console]) expect(text).not.toContain(MARKER);
  await hosted.dispose();
  hosted = undefined;
});

/** A profile on the cloud, made through its API as the allowed subject. */
async function cloudProfile(page: Page, name: string): Promise<{ id: string; revision: number }> {
  const response = await page.request.post(`${hosted!.cloud.origin}/api/profiles`, {
    headers: { authorization: `Bearer ${hosted!.issuer.token()}` },
    data: look(name),
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; revision: number };
}

/** The sign-in page, its button, the provider, and back on the screen (AC20). */
async function signIn(page: Page) {
  await page.goto(`${hosted!.cloud.origin}/`);
  await expect(page.getByTestId("sign-in")).toBeVisible();
  await page.getByTestId("sign-in-button").click();
  await expect(page.getByTestId("screen")).toBeVisible();
  expect(new URL(page.url()).search).toBe(""); // no code or state left in the address bar
}

/** Two canvas reads 500 ms apart differ (as screen.spec.ts), left of the panel (top right). */
async function expectCanvasChanging(page: Page) {
  const viewport = page.viewportSize()!;
  const clip = { x: 40, y: viewport.height / 2, width: 4, height: 4 };
  const first = await page.screenshot({ clip });
  await page.waitForTimeout(500);
  expect((await page.screenshot({ clip })).equals(first), "the canvas did not change").toBe(false);
}

test("a sign-in page first; the allowed subject gets the screen with the cloud's profiles, and the builder (AC20)", async ({
  page,
  context,
}) => {
  await setup(context);
  const stored = await cloudProfile(page, "From the cloud");
  await signIn(page);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByTestId("panel")).toHaveCount(0);
  await page.keyboard.press("s");
  await expect(page.getByTestId("profile-picker")).toBeEnabled();
  await expect(page.getByTestId("profile-picker").locator("option")).toContainText([
    "Built-in",
    "From the cloud",
  ]);
  await page.getByTestId("profile-picker").selectOption(stored.id);
  await expect(page.getByTestId("profile-reason")).toHaveCount(0);

  // A full page load: the tab signed in, so it goes to the provider and back by itself (PD1).
  await page.goto(`${hosted!.cloud.origin}/builder`);
  await expect(page.getByTestId(`profile-name-${stored.id}`)).toHaveText("From the cloud");
  await expect(page.getByTestId("sign-in")).toHaveCount(0);
});

test("another subject sees This account has no access and gets 403 (AC2)", async ({
  page,
  context,
}) => {
  await setup(context);
  hosted!.issuer.subject = "someone-not-allowed";
  const statuses: number[] = [];
  page.on("response", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/profiles")) statuses.push(r.status());
  });
  await page.goto(`${hosted!.cloud.origin}/`);
  await page.getByTestId("sign-in-button").click();
  await expect(page.getByTestId("sign-in-line")).toHaveText("This account has no access");
  await expect(page.getByTestId("screen")).toHaveCount(0);
  expect(statuses.length).toBeGreaterThan(0);
  expect(statuses.every((s) => s === 403)).toBe(true);
});

test("hosted use shows no External control, QR codes or senders, and says where it lives (AC21)", async ({
  page,
  context,
}) => {
  await setup(context);
  const sockets: string[] = [];
  page.on("websocket", (ws) => sockets.push(ws.url()));
  await signIn(page);
  await expect(page.getByTestId("hosted-control-line")).toHaveText(
    "External control needs the local install",
  );
  await expect(page.getByTestId("control-switch")).toHaveCount(0);
  await expect(page.locator("svg[data-testid*='qr'], [data-testid*='qr']")).toHaveCount(0);
  await expect(page.getByText("Senders", { exact: false })).toHaveCount(0);
  expect(sockets).toEqual([]); // no screen socket in hosted use
  await page.goto(`${hosted!.cloud.origin}/control`);
  expect((await page.request.get(`${hosted!.cloud.origin}/control`)).status()).toBe(404);
});

test("a stale save offers Reload theirs / Save mine as a copy and changes nothing until chosen (AC22)", async ({
  page,
  context,
}) => {
  await setup(context);
  const stored = await cloudProfile(page, "Shared");
  await signIn(page);
  await page.goto(`${hosted!.cloud.origin}/builder`);
  await page.getByTestId(`profile-name-${stored.id}`).click();
  await page.getByTestId("editor-name").fill("Mine");
  // Saved elsewhere meanwhile.
  const elsewhere = await page.request.put(`${hosted!.cloud.origin}/api/profiles/${stored.id}`, {
    headers: { authorization: `Bearer ${hosted!.issuer.token()}` },
    data: { ...look("Theirs"), revision: stored.revision },
  });
  expect(elsewhere.status()).toBe(200);
  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("conflict-reload")).toHaveText("Reload theirs");
  await expect(page.getByTestId("conflict-copy")).toHaveText("Save mine as a copy");
  const now = await page.request.get(`${hosted!.cloud.origin}/api/profiles`, {
    headers: { authorization: `Bearer ${hosted!.issuer.token()}` },
  });
  expect(
    ((await now.json()) as { profiles: { name: string }[] }).profiles.map((p) => p.name),
  ).toEqual(["Theirs"]);
  await page.getByTestId("conflict-copy").click();
  await expect(page.getByText("Mine", { exact: true })).toBeVisible();
});

test("a renewal refused mid-set: the canvas keeps drawing, a pick fails with one reason, Sign in again shows; only allowed requests (AC23)", async ({
  page,
  context,
}) => {
  // ID tokens live 75 s: renewal is due (within 60 s of exp) about 15 s after sign-in.
  await setup(context, { lifetime: 75 });
  const stored = await cloudProfile(page, "Wanted");
  const issuerOrigin = new URL(hosted!.issuer.url).origin;
  await signIn(page);
  const signedInAt = Date.now();
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByTestId("panel")).toHaveCount(0);
  // The panel opened once while the token is fresh: the list holds the cloud's profile.
  await page.keyboard.press("s");
  const picker = page.getByTestId("profile-picker");
  await expect(picker.locator(`option[value="${stored.id}"]`)).toHaveCount(1);
  await expect(page.getByTestId("profile-reason")).toHaveCount(0);

  const requests: { at: number; line: string }[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    const where = url.origin === issuerOrigin ? "issuer" : "cloud";
    requests.push({ at: Date.now(), line: `${where} ${r.method()} ${url.pathname}` });
  });
  page.on("websocket", (ws) => requests.push({ at: Date.now(), line: `WS ${ws.url()}` }));

  hosted!.issuer.refuseRefresh = true;
  await page.waitForTimeout(Math.max(0, signedInAt + 17_000 - Date.now()));
  await expectCanvasChanging(page);
  expect(requests).toEqual([]); // the set made no request while nothing was asked of it

  const pickedAt = Date.now();
  await picker.selectOption(stored.id); // the user's action: renewal is due, and refused
  await expect(page.getByTestId("profile-reason")).toHaveText(
    "profiles unavailable: sign in again; keeping the current look",
  );
  await expect(page.getByTestId("sign-in-again")).toBeVisible();
  await expectCanvasChanging(page);

  const allowed =
    /^cloud GET (\/|\/assets\/[^/]+|\/api\/health|\/api\/profiles|\/api\/profiles\/[^/]+)$/;
  const cloudLines = requests.filter((r) => r.line.startsWith("cloud ")).map((r) => r.line);
  expect(cloudLines.filter((l) => !allowed.test(l))).toEqual([]);
  expect(requests.filter((r) => r.line.startsWith("WS "))).toEqual([]);
  const toIssuer = requests.filter((r) => r.line.startsWith("issuer "));
  expect(toIssuer.length).toBeGreaterThan(0); // the refused renewal
  for (const r of toIssuer) {
    expect(r.at).toBeGreaterThanOrEqual(pickedAt); // only on the user's action
    expect(r.line).toMatch(/^issuer (POST \/token|GET \/\.well-known\/openid-configuration)$/);
  }
});
