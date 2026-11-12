// The profile builder in a real browser (B-02 AC1, AC2, AC7; plan T10): profiles are created
// through the real API and read back through it. Later tasks add the editor, conflicts, export
// and import to this file.
import { expect, test, type Page } from "@playwright/test";
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
