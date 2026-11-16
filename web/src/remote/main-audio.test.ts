// T11 (B-06 spec SD7, SD22, AC18, AC19, AC20, AC21): the main-audio choice and the source that
// plays, against a clock the test moves.
import { describe, expect, it } from "vitest";
import { createMainAudio, RETURN_MS } from "./main-audio.ts";

const T = 10_000;

describe("arrival (SD8, AC17)", () => {
  it("has no view before an audio sender arrives", () => {
    const main = createMainAudio();
    expect(main.view(T)).toBeNull();
    expect(main.playing(T)).toBe("local");
  });

  it("an arriving sender sets the choice to remote and plays it at once", () => {
    const main = createMainAudio();
    main.arrived("Device 2");
    expect(main.playing(T)).toBe("remote");
    expect(main.view(T)).toEqual({
      choice: "remote",
      playing: "remote",
      label: "Device 2",
      line: "audio: remote (Device 2) ok",
    });
  });
});

describe("fallback and return (SD7, AC18, AC19)", () => {
  it("lost plays local in the same call, with the fallback line", () => {
    const main = createMainAudio();
    main.arrived("Device 2");
    main.lost();
    expect(main.playing(T)).toBe("local");
    expect(main.view(T)).toMatchObject({
      choice: "remote",
      playing: "local",
      line: "audio: local (fallback: remote lost)",
    });
  });

  it("returns only after 3 s back and steady", () => {
    const main = createMainAudio();
    main.arrived("Device 2");
    main.lost();
    main.back(T);
    expect(main.playing(T + RETURN_MS - 1)).toBe("local");
    expect(main.view(T + RETURN_MS - 1)?.line).toBe("audio: local (fallback: remote lost)");
    expect(main.playing(T + RETURN_MS)).toBe("remote");
    expect(RETURN_MS).toBe(3000);
  });

  it("a loss inside the 3 s starts them over: back at t, lost at t+2900, back at t+3000", () => {
    const main = createMainAudio();
    main.arrived("Device 2");
    main.lost();
    main.back(T);
    main.lost();
    expect(main.playing(T + 2900)).toBe("local");
    main.back(T + 3000);
    expect(main.playing(T + 3000)).toBe("local");
    expect(main.playing(T + 5999)).toBe("local");
    expect(main.playing(T + 6000)).toBe("remote");
  });

  it("back without a loss changes nothing", () => {
    const main = createMainAudio();
    main.arrived("Device 2");
    main.back(T);
    expect(main.playing(T)).toBe("remote");
  });
});

describe("the choice (SD22, AC20)", () => {
  it("choose local holds through any number of back()", () => {
    const main = createMainAudio();
    main.arrived("Device 2");
    main.choose("local");
    for (let i = 0; i < 5; i += 1) {
      main.lost();
      main.back(T + i);
    }
    expect(main.playing(T + 60_000)).toBe("local");
    expect(main.view(T + 60_000)).toEqual({
      choice: "local",
      playing: "local",
      label: "Device 2",
      line: "audio: local",
    });
  });

  it("choose remote while lost plays local with the fallback line", () => {
    const main = createMainAudio();
    main.arrived("Device 2");
    main.choose("local");
    main.lost();
    main.choose("remote");
    expect(main.playing(T)).toBe("local");
    expect(main.view(T)?.line).toBe("audio: local (fallback: remote lost)");
  });

  it("choose remote while steady plays remote at once", () => {
    const main = createMainAudio();
    main.arrived("Device 2");
    main.choose("local");
    main.choose("remote");
    expect(main.playing(T)).toBe("remote");
  });

  it("a new sender arriving after a local choice sets it to remote again", () => {
    const main = createMainAudio();
    main.arrived("Device 2");
    main.choose("local");
    main.gone();
    main.arrived("Device 5");
    expect(main.view(T)).toMatchObject({ choice: "remote", playing: "remote", label: "Device 5" });
  });
});

describe("gone (SD8)", () => {
  it("gone → view null and local plays", () => {
    const main = createMainAudio();
    main.arrived("Device 2");
    main.gone();
    expect(main.view(T)).toBeNull();
    expect(main.playing(T)).toBe("local");
  });

  it("choose, lost and back without a sender do nothing", () => {
    const main = createMainAudio();
    main.choose("remote");
    main.lost();
    main.back(T);
    expect(main.view(T)).toBeNull();
    expect(main.playing(T + RETURN_MS)).toBe("local");
  });
});
