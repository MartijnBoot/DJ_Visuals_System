// The page `pnpm profile:check` drives (B-03 spec SD7; plan PD12, T13): the real engine, served
// type-stripped by the script, on a blank page that ships nowhere. The page owns
// `requestAnimationFrame`, so the engine draws exactly when the script steps a frame, on a clock
// of 1/60 s per frame: the same file gives the same frames on every run.
import {
  createEngine,
  ProfileCompileError,
  type CompileIssue,
  type Profile,
} from "../engine/src/index.ts";

/** What the script reads back for one profile. */
export type Compiled = { ok: true } | { ok: false; issues: CompileIssue[] };

const FRAME_MS = 1000 / 60;
const WIDTH = 640;
const HEIGHT = 360;

let queue: FrameRequestCallback[] = [];
let clock = 0;
window.requestAnimationFrame = (callback) => {
  queue.push(callback);
  return queue.length;
};
window.cancelAnimationFrame = () => {};

/** One frame: every callback queued, at the next tick of the fixed clock. */
function step(): void {
  clock += FRAME_MS;
  const due = queue;
  queue = [];
  for (const callback of due) callback(clock);
}

/** A canvas laid out at the stills' size, so the engine draws at it. */
function canvas(): HTMLCanvasElement {
  const element = document.createElement("canvas");
  element.style.width = `${WIDTH}px`;
  element.style.height = `${HEIGHT}px`;
  element.style.display = "block";
  document.body.replaceChildren(element);
  return element;
}

/** Gives the browser a turn, so a resolved promise is seen before the next frame. */
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Compiles one profile in the real engine: steps frames until it is swapped in or refused. */
async function compile(profile: Profile): Promise<Compiled> {
  const element = canvas();
  const engine = createEngine(element);
  engine.start();
  let result: Compiled | null = null;
  engine.setProfile(profile).then(
    () => (result = { ok: true }),
    (error: unknown) =>
      (result = {
        ok: false,
        issues:
          error instanceof ProfileCompileError
            ? [...error.issues]
            : [{ effectIndex: -1, label: "", line: 0, message: String(error) }],
      }),
  );
  for (let frame = 0; frame < 600 && result === null; frame++) {
    step();
    await turn();
  }
  engine.stop();
  element.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
  return (
    result ?? {
      ok: false,
      issues: [{ effectIndex: -1, label: "", line: 0, message: "the link never finished" }],
    }
  );
}

(window as unknown as { profileCheck: unknown }).profileCheck = { compile };
document.title = "ready";
