// The profile builder in a real browser (B-02 AC1, AC2, AC7; plan T10): profiles are created
// through the real API and read back through it. Later tasks add the editor, conflicts, export
// and import to this file.
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";
import { createProfile, deleteAll, flat, listStored } from "./fixtures/profiles.ts";

test.beforeEach(async ({ request }) => {
  await deleteAll(request);
});

/** The names listed, built-in included, in order. */
const names = (page: Page) => page.locator("[data-testid^=profile-name-]").allTextContents();

const rowFor = (page: Page, name: string) =>
  page.locator("[data-testid^=profile-row-]", { hasText: name });

test("a fresh server shows the built-in and the empty state (AC1)", async ({ page }) => {
  await page.goto("/builder");
  await expect(page.getByTestId("profile-row-builtin")).toBeVisible();
  expect(await names(page)).toEqual(["Built-in"]);
  await expect(page.getByTestId("list-state")).toContainText("No profiles yet");
  await expect(page.getByRole("button", { name: "Create profile" })).toBeEnabled();
});

test("three names in mixed case list alphabetically after the built-in (AC1)", async ({
  page,
  request,
}) => {
  for (const name of ["charlie", "Alpha", "bravo"])
    await createProfile(request, flat(name, "#112233"));
  await page.goto("/builder");
  await expect(page.getByTestId("list-state")).toHaveText("");
  expect(await names(page)).toEqual(["Built-in", "Alpha", "bravo", "charlie"]);
});

test("create from the built-in and from a preset each appear with a unique name at revision 1 (AC2)", async ({
  page,
  request,
}) => {
  await page.goto("/builder");
  await page.getByRole("button", { name: "Create profile" }).click();
  await expect(rowFor(page, "New profile")).toHaveCount(1);
  await page.getByTestId("create-source").selectOption("preset:Warm");
  await page.getByRole("button", { name: "Create profile" }).click();
  await expect(rowFor(page, "New profile (2)")).toHaveCount(1);
  expect(await names(page)).toEqual(["Built-in", "New profile", "New profile (2)"]);

  const stored = await listStored(request);
  expect(stored.map((p) => [p.name, p.revision])).toEqual([
    ["New profile", 1],
    ["New profile (2)", 1],
  ]);
  expect(stored[0]!.palette).toEqual(["#000000", "#ffffff"]); // a copy of the built-in
  expect(stored[0]!.effects).toHaveLength(9);
  expect(stored[1]!.palette).toEqual(["#1a0500", "#c2410c", "#fbbf24", "#fff7ed"]);
  expect(stored[1]!.effects.map((e) => e.type)).toContain("paletteMap");
  expect(new Set(stored.map((p) => p.id)).size).toBe(2);
});

test("duplicate gives a unique name at revision 1, and rename keeps the id (AC2, AD1)", async ({
  page,
  request,
}) => {
  const alpha = await createProfile(request, flat("Alpha", "#112233"));
  await page.goto("/builder");
  await page.getByTestId(`profile-duplicate-${alpha.id}`).click();
  await expect(rowFor(page, "Alpha (2)")).toHaveCount(1);
  const copies = await listStored(request);
  expect(copies.map((p) => [p.name, p.revision])).toEqual([
    ["Alpha", 1],
    ["Alpha (2)", 1],
  ]);
  const copy = copies[1]!;
  expect(copy.id).not.toBe(alpha.id);
  expect(copy.palette).toEqual(alpha.palette);

  await page.getByTestId(`profile-rename-${copy.id}`).click();
  await page.getByTestId("rename-input").fill("  Zulu  ");
  await page.getByTestId("rename-save").click();
  await expect(rowFor(page, "Zulu")).toHaveCount(1);
  expect(await names(page)).toEqual(["Built-in", "Alpha", "Zulu"]);
  const renamed = (await listStored(request)).find((p) => p.name === "Zulu")!;
  expect(renamed.id).toBe(copy.id);
  expect(renamed.revision).toBe(2);
});

test("duplicating the built-in gives an editable copy (AC2)", async ({ page, request }) => {
  await page.goto("/builder");
  await page.getByTestId("profile-duplicate-builtin").click();
  await expect(page.locator("[data-testid^=profile-row-]")).toHaveCount(2);
  const [copy] = await listStored(request);
  expect(copy!.name).toBe("Built-in (2)");
  expect(copy!.revision).toBe(1);
});

test("renaming onto a taken name in another case is refused in place and changes nothing (AC7)", async ({
  page,
  request,
}) => {
  const alpha = await createProfile(request, flat("Alpha", "#112233"));
  const bravo = await createProfile(request, flat("Bravo", "#112233"));
  await page.goto("/builder");
  await page.getByTestId(`profile-rename-${bravo.id}`).click();
  await page.getByTestId("rename-input").fill("alpha");
  await page.getByTestId("rename-save").click();
  await expect(page.getByTestId("name-error")).toHaveText("that name is taken");
  const stored = await listStored(request);
  expect(stored.map((p) => [p.name, p.revision])).toEqual([
    ["Alpha", 1],
    ["Bravo", 1],
  ]);
  expect(stored[0]!.id).toBe(alpha.id);
});

test("a rename outside 1 to 60 characters is refused in place, with nothing sent (AC2, SD14)", async ({
  page,
  request,
}) => {
  const alpha = await createProfile(request, flat("Alpha", "#112233"));
  await page.goto("/builder");
  let writes = 0;
  page.on("request", (r) => {
    if (r.method() === "PUT") writes++;
  });
  await page.getByTestId(`profile-rename-${alpha.id}`).click();
  await page.getByTestId("rename-input").fill("   ");
  await page.getByTestId("rename-save").click();
  await expect(page.getByTestId("name-error")).toBeVisible();
  await page.getByTestId("rename-input").fill("x".repeat(61));
  await page.getByTestId("rename-save").click();
  await expect(page.getByTestId("name-error")).toBeVisible();
  expect(writes).toBe(0);
  expect((await listStored(request))[0]!.name).toBe("Alpha");
});

test("delete asks first: dismissing keeps the profile, accepting removes it (AC2)", async ({
  page,
  request,
}) => {
  const alpha = await createProfile(request, flat("Alpha", "#112233"));
  await page.goto("/builder");
  const asked: string[] = [];
  page.once("dialog", (dialog) => {
    asked.push(dialog.message());
    void dialog.dismiss();
  });
  await page.getByTestId(`profile-delete-${alpha.id}`).click();
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain("Alpha");
  await expect(rowFor(page, "Alpha")).toHaveCount(1);
  expect(await listStored(request)).toHaveLength(1);

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByTestId(`profile-delete-${alpha.id}`).click();
  await expect(rowFor(page, "Alpha")).toHaveCount(0);
  expect(await listStored(request)).toEqual([]);
});

test("the built-in offers duplicate and no rename or delete (AC2)", async ({ page }) => {
  await page.goto("/builder");
  await expect(page.getByTestId("profile-duplicate-builtin")).toBeEnabled();
  await expect(page.getByTestId("profile-rename-builtin")).toHaveCount(0);
  await expect(page.getByTestId("profile-delete-builtin")).toHaveCount(0);
});

test("with the profile API failing, the list shows the built-in, a line, and writes are disabled", async ({
  page,
}) => {
  await page.route("**/api/profiles", (route) => route.abort());
  await page.goto("/builder");
  await expect(page.getByTestId("list-state")).toContainText("Profiles unavailable");
  expect(await names(page)).toEqual(["Built-in"]);
  await expect(page.getByRole("button", { name: "Create profile" })).toBeDisabled();
  await expect(page.getByTestId("profile-duplicate-builtin")).toBeDisabled();
});

test("every control is reachable by Tab", async ({ page, request }) => {
  const alpha = await createProfile(request, flat("Alpha", "#112233"));
  await page.goto("/builder");
  await expect(rowFor(page, "Alpha")).toHaveCount(1);
  const reached = new Set<string>();
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    reached.add(
      (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) ?? "",
    );
  }
  for (const id of [
    "create-source",
    "create-button",
    "profile-name-builtin",
    "profile-duplicate-builtin",
    `profile-name-${alpha.id}`,
    `profile-duplicate-${alpha.id}`,
    `profile-rename-${alpha.id}`,
    `profile-delete-${alpha.id}`,
  ]) {
    expect(reached, id).toContain(id);
  }
});

test("the builder page is not the screen page, and the screen page has no builder UI", async ({
  page,
}) => {
  await page.goto("/builder");
  await expect(page.getByTestId("screen")).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByTestId("builder")).toHaveCount(0);
});

const editorOf = (page: Page) => page.getByTestId("editor");

/** The stored profile with this name, read through the API. */
async function stored(request: APIRequestContext, name: string) {
  return (await listStored(request)).find((p) => p.name === name)!;
}

test("edit the palette, effects, binding and dials, Save: the API holds exactly that at revision 2 (AC3, AC5)", async ({
  page,
  request,
}) => {
  await page.goto("/builder");
  await page.getByRole("button", { name: "Create profile" }).click();
  await expect(editorOf(page)).toBeVisible();

  await page.getByTestId("palette-add").click();
  await page.getByTestId("palette-colour-0").fill("#112233");
  await page.getByTestId("palette-colour-1").fill("#445566");
  await page.getByTestId("palette-colour-2").fill("#778899");
  await page.getByTestId("effect-add").selectOption("paletteMap");
  await page.getByTestId("effect-add").selectOption("mirror");
  await page.getByTestId("effect-segments-mirror").fill("6");
  await page.getByTestId("effect-feature-flash").selectOption("high");
  await page.getByTestId("effect-up-mirror").click();
  await page.getByTestId("editor-dial-recognisability").fill("0.6");
  await page.getByTestId("editor-dial-reactivity").fill("0.25");
  await expect(page.getByTestId("editor-save")).toBeEnabled();
  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("editor-save")).toBeDisabled(); // saved: nothing left to save

  const saved = await stored(request, "New profile");
  expect(saved.revision).toBe(2);
  expect(saved.palette).toEqual(["#112233", "#445566", "#778899"]);
  expect(saved.dials).toEqual({ recognisability: 0.6, reactivity: 0.25 });
  expect(saved.effects.map((e) => e.type)).toEqual([
    "edges",
    "displace",
    "zoom",
    "posterise",
    "smear",
    "brightness",
    "grain",
    "flash",
    "pixelate",
    "mirror",
    "paletteMap",
  ]);
  expect(saved.effects.find((e) => e.type === "mirror")).toMatchObject({ segments: 6 });
  expect(saved.effects.find((e) => e.type === "flash")).toMatchObject({
    binding: { feature: "high", amount: 1 },
    colourSlot: 1,
  });
});

test("the add menu never lists a present type and is empty at twelve (AC3)", async ({
  page,
  request,
}) => {
  const one = await createProfile(request, flat("One", "#112233"));
  await page.goto("/builder");
  await page.getByTestId(`profile-name-${one.id}`).click();
  const add = page.getByTestId("effect-add");
  const offered = async () =>
    (await add.locator("option").allTextContents()).filter((t) => t !== "choose…");
  expect(await offered()).not.toContain("paletteMap");
  expect(await offered()).toHaveLength(11);

  for (const type of await offered()) await add.selectOption(type);
  await expect(page.locator("[data-testid^=effect-row-]")).toHaveCount(12);
  await expect(add).toBeDisabled();
  expect(await add.locator("option").allTextContents()).toEqual(["no effects left"]);
});

test("palette remove is disabled at two colours and add at six (AC3)", async ({
  page,
  request,
}) => {
  const one = await createProfile(request, flat("One", "#112233"));
  await page.goto("/builder");
  await page.getByTestId(`profile-name-${one.id}`).click();
  await expect(page.getByTestId("palette-remove-0")).toBeDisabled();
  await expect(page.getByTestId("palette-remove-1")).toBeDisabled();
  for (let i = 0; i < 4; i++) await page.getByTestId("palette-add").click();
  await expect(page.locator("[data-testid^=palette-colour-]")).toHaveCount(6);
  await expect(page.getByTestId("palette-add")).toBeDisabled();
  await expect(page.getByTestId("palette-remove-5")).toBeEnabled();
});

test("an empty name disables Save and says why (AC3, AC8)", async ({ page, request }) => {
  const one = await createProfile(request, flat("One", "#112233"));
  await page.goto("/builder");
  await page.getByTestId(`profile-name-${one.id}`).click();
  await page.getByTestId("effect-amount-paletteMap").fill("0.4"); // dirty, so only the name blocks Save
  await expect(page.getByTestId("editor-save")).toBeEnabled();
  await page.getByTestId("editor-name").fill("");
  await expect(page.getByTestId("editor-save")).toBeDisabled();
  await expect(page.getByTestId("editor-name-error")).toBeVisible();
  await expect(page.getByTestId("editor-issues")).toContainText("name");
});

test("the built-in is shown read-only, with nothing to save (SD8)", async ({ page }) => {
  await page.goto("/builder");
  await expect(page.getByTestId("editor-readonly")).toBeVisible();
  await expect(page.getByTestId("editor-name")).toBeDisabled();
  await expect(page.getByTestId("editor-save")).toHaveCount(0);
});

test("the editor is operable by keyboard alone (AC3)", async ({ page, request }) => {
  const one = await createProfile(request, flat("One", "#112233"));
  await page.goto("/builder");
  await page.getByTestId(`profile-name-${one.id}`).click();
  const reached = new Set<string>();
  let saveFocused = false;
  await page.getByTestId("editor-name").focus();
  await page.keyboard.press("End");
  await page.keyboard.type(" two");
  for (let i = 0; i < 120 && !saveFocused; i++) {
    await page.keyboard.press("Tab");
    const id =
      (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) ?? "";
    reached.add(id);
    saveFocused = id === "editor-save";
  }
  expect(saveFocused, "Tab never reached Save").toBe(true);
  for (const id of [
    "editor-dial-recognisability",
    "editor-dial-reactivity",
    "palette-preset",
    "palette-colour-0",
    "palette-add",
    "effect-remove-paletteMap",
    "effect-amount-paletteMap",
    "effect-feature-paletteMap",
    "effect-add",
  ]) {
    expect(reached, id).toContain(id);
  }
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await stored(request, "One two"))?.revision).toBe(2);
});

/** Opens the builder with one stored profile selected. */
async function openProfile(page: Page, id: string) {
  await page.goto("/builder");
  await page.getByTestId(`profile-name-${id}`).click();
  await expect(page.getByTestId("editor")).toBeVisible();
}

const amountOf = (page: Page) => page.getByTestId("effect-amount-paletteMap");

/** Two pages on one profile, both with an edit; the first has saved (T12, AC6). */
async function conflictingPair(
  page: Page,
  context: BrowserContext,
  request: APIRequestContext,
  name = "Shared",
) {
  const shared = await createProfile(request, flat(name, "#112233"));
  const second = await context.newPage();
  await openProfile(page, shared.id);
  await openProfile(second, shared.id);
  await amountOf(page).fill("0.3");
  await amountOf(second).fill("0.9");
  await page.getByTestId("editor-save").click();
  await expect.poll(async () => (await stored(request, name)).revision).toBe(2);
  return { shared, second };
}

test("a stale save shows the choice and the API still holds the first save (AC6)", async ({
  page,
  context,
  request,
}) => {
  const { second } = await conflictingPair(page, context, request);
  await second.getByTestId("editor-save").click();
  await expect(second.getByTestId("conflict")).toBeVisible();
  await expect(second.getByTestId("conflict-reload")).toHaveText("Reload theirs");
  await expect(second.getByTestId("conflict-copy")).toHaveText("Save mine as a copy");
  await expect(amountOf(second)).toHaveValue("0.9"); // the draft is not lost
  const now = await stored(request, "Shared");
  expect(now.revision).toBe(2);
  expect(now.effects[0]).toMatchObject({ amount: 0.3 });
  expect(await listStored(request)).toHaveLength(1);
});

test("Reload theirs shows the first save's values (AC6)", async ({ page, context, request }) => {
  const { second } = await conflictingPair(page, context, request);
  await second.getByTestId("editor-save").click();
  await second.getByTestId("conflict-reload").click();
  await expect(second.getByTestId("conflict")).toHaveCount(0);
  await expect(amountOf(second)).toHaveValue("0.3");
  await expect(second.getByTestId("editor-dirty")).toHaveCount(0);
});

test("Save mine as a copy creates 'Name (2)' with the second page's values and leaves the original (AC6)", async ({
  page,
  context,
  request,
}) => {
  const { second } = await conflictingPair(page, context, request);
  await second.getByTestId("editor-save").click();
  await second.getByTestId("conflict-copy").click();
  await expect(second.getByTestId("conflict")).toHaveCount(0);
  await expect(second.getByTestId("editor-name")).toHaveValue("Shared (2)");
  await expect(amountOf(second)).toHaveValue("0.9");
  const all = await listStored(request);
  expect(all.map((p) => [p.name, p.revision])).toEqual([
    ["Shared", 2],
    ["Shared (2)", 1],
  ]);
  expect(all[0]!.effects[0]).toMatchObject({ amount: 0.3 });
  expect(all[1]!.effects[0]).toMatchObject({ amount: 0.9 });
  expect(await names(second)).toEqual(["Built-in", "Shared", "Shared (2)"]);
});

test("a profile deleted elsewhere offers 'Save as a new profile' and loses nothing (AC6)", async ({
  page,
  request,
}) => {
  const gone = await createProfile(request, flat("Gone", "#112233"));
  await openProfile(page, gone.id);
  await amountOf(page).fill("0.7");
  await request.delete(`/api/profiles/${gone.id}`);
  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("conflict")).toContainText("deleted elsewhere");
  await expect(page.getByTestId("conflict-reload")).toHaveCount(0);
  await page.getByTestId("conflict-copy").click();
  await expect(page.getByTestId("conflict")).toHaveCount(0);
  const all = await listStored(request);
  expect(all.map((p) => p.name)).toEqual(["Gone"]);
  expect(all[0]!.id).not.toBe(gone.id);
  expect(all[0]!.effects[0]).toMatchObject({ amount: 0.7 });
});

test("the dirty mark appears with an edit and Revert to last saved restores the saved state (AC5)", async ({
  page,
  request,
}) => {
  const one = await createProfile(request, flat("One", "#112233"));
  await openProfile(page, one.id);
  await expect(page.getByTestId("editor-dirty")).toHaveCount(0);
  await expect(page.getByTestId("editor-revert")).toBeDisabled();
  await page.getByTestId("editor-name").fill("Changed");
  await amountOf(page).fill("0.1");
  await expect(page.getByTestId("editor-dirty")).toHaveText("unsaved changes");
  await page.getByTestId("editor-revert").click();
  await expect(page.getByTestId("editor-name")).toHaveValue("One");
  await expect(amountOf(page)).toHaveValue("1");
  await expect(page.getByTestId("editor-dirty")).toHaveCount(0);
  expect((await stored(request, "One")).revision).toBe(1);
});

test("leaving unsaved changes asks first: another profile, the back link, and the tab (T12)", async ({
  page,
  request,
}) => {
  const one = await createProfile(request, flat("One", "#112233"));
  const two = await createProfile(request, flat("Two", "#112233"));
  await openProfile(page, one.id);
  await page.getByTestId("editor-name").fill("One edited");

  const asked: string[] = [];
  page.once("dialog", (d) => {
    asked.push(d.message());
    void d.dismiss();
  });
  await page.getByTestId(`profile-name-${two.id}`).click();
  expect(asked).toHaveLength(1);
  await expect(page.getByTestId("editor-name")).toHaveValue("One edited");

  page.once("dialog", (d) => void d.dismiss());
  await page.getByRole("link", { name: "Back to the screen" }).click();
  await expect(page).toHaveURL(/\/builder$/);

  // beforeunload is set while dirty only.
  const blocks = () =>
    page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
  expect(await blocks()).toBe(true);

  page.once("dialog", (d) => void d.accept());
  await page.getByTestId(`profile-name-${two.id}`).click();
  await expect(page.getByTestId("editor-name")).toHaveValue("Two");
  expect(await blocks()).toBe(false);
});

test("with the save request failing the draft survives, and Save works once it is restored (AC5)", async ({
  page,
  request,
}) => {
  const one = await createProfile(request, flat("One", "#112233"));
  await openProfile(page, one.id);
  const fail = (route: Route) =>
    route.request().method() === "PUT" ? route.abort() : route.continue();
  await page.route("**/api/profiles/*", fail);
  await amountOf(page).fill("0.4");
  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("editor-save-error")).toContainText("could not save");
  await expect(amountOf(page)).toHaveValue("0.4");
  await expect(page.getByTestId("editor-save")).toBeEnabled();
  expect((await stored(request, "One")).revision).toBe(1);

  await page.unroute("**/api/profiles/*", fail);
  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("editor-dirty")).toHaveCount(0);
  const saved = await stored(request, "One");
  expect(saved.revision).toBe(2);
  expect(saved.effects[0]).toMatchObject({ amount: 0.4 });
});
