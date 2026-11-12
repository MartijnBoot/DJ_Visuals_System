// Profiles for the browser specs (B-02), created through the real API (plan T9): never a hook on
// the page. A profile whose only effect is a palette map onto one colour paints the whole frame
// that colour, so a patch of the canvas says which profile is showing.
import type { APIRequestContext } from "@playwright/test";

export interface Definition {
  name: string;
  palette: string[];
  dials: { recognisability: number; reactivity: number };
  effects: Record<string, unknown>[];
}

export interface Stored extends Definition {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** A frame of one flat colour, starting dials as given. */
export function flat(
  name: string,
  colour: string,
  dials = { recognisability: 0.5, reactivity: 0.5 },
): Definition {
  return { name, palette: [colour, colour], dials, effects: [{ type: "paletteMap", amount: 1 }] };
}

export const RED_RGB = [255, 0, 0] as const;
export const BLUE_RGB = [0, 0, 255] as const;

export const red = (name = "Aaa Red") =>
  flat(name, "#ff0000", { recognisability: 0.9, reactivity: 0.2 });
export const blue = (name = "Bbb Blue") =>
  flat(name, "#0000ff", { recognisability: 0.1, reactivity: 0.4 });

export async function createProfile(
  request: APIRequestContext,
  definition: Definition,
): Promise<Stored> {
  const response = await request.post("/api/profiles", { data: definition });
  if (response.status() !== 201) throw new Error(`create gave ${response.status()}`);
  return (await response.json()) as Stored;
}

export async function listStored(request: APIRequestContext): Promise<Stored[]> {
  const response = await request.get("/api/profiles");
  return ((await response.json()) as { profiles: Stored[] }).profiles;
}

export async function updateProfile(
  request: APIRequestContext,
  stored: Stored,
  changes: Partial<Definition>,
): Promise<Stored> {
  const { id, revision, createdAt: _created, updatedAt: _updated, ...definition } = stored;
  const response = await request.put(`/api/profiles/${id}`, {
    data: { ...definition, ...changes, revision },
  });
  if (response.status() !== 200) throw new Error(`update gave ${response.status()}`);
  return (await response.json()) as Stored;
}

/** The server outlives each test, so every test starts from an empty database. */
export async function deleteAll(request: APIRequestContext): Promise<void> {
  for (const profile of await listStored(request)) {
    await request.delete(`/api/profiles/${profile.id}`);
  }
}
