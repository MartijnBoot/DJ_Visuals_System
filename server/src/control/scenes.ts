// Scenes over the screen socket (B-07 spec SD7, SD8, SD18, SD20; plan PD9, T3): each `scenes.*`
// request from the target screen is answered by one `scenes.result`, and every answer to a change
// carries the new list. An import arrives in parts, each validated on arrival and all stored in
// one transaction at the last; a new import id, the target's close or 30 s without a part
// discards them. Logs name ids and counts only, never a name or a definition (SD20).
import {
  issuesFrom,
  sceneFileSchema,
  sceneNameAt,
  type SceneDefinition,
  type SceneError,
  type SceneIssue,
  type SceneRequest,
  type SceneResult,
} from "@djv/shared";
import type { SceneStore, SceneWriteResult } from "../scenes/store.ts";

/** PD9: an import whose next part has not come in this long is discarded. */
export const IMPORT_IDLE_MS = 30_000;

export interface SceneRequests {
  answer(request: SceneRequest): SceneResult;
  /** Drops an import in progress: the target screen closed or another took over. */
  discard(): void;
}

interface Importing {
  importId: number;
  parts: number;
  /** The next part expected. */
  next: number;
  entries: { name: string; definition: SceneDefinition }[];
  timer: ReturnType<typeof setTimeout>;
}

/** One file entry as the import reads it, so an issue's path is the file's own. */
const entrySchema = sceneFileSchema.shape.scenes.element;

export function createSceneRequests(
  store: SceneStore,
  log: { info(fields: object, message: string): void },
): SceneRequests {
  let importing: Importing | null = null;

  const discard = () => {
    if (importing) clearTimeout(importing.timer);
    importing = null;
  };

  const list = () => store.list().map(({ id, name }) => ({ id, name }));
  const refused = (requestId: number, reason: SceneError, issues?: SceneIssue[]): SceneResult => ({
    type: "scenes.result",
    requestId,
    ok: false,
    error: issues ? { reason, issues } : { reason },
  });
  /** A write's answer: the scene and the new list, or why nothing was stored. */
  const written = (requestId: number, result: SceneWriteResult, event: string): SceneResult => {
    if (result.kind !== "ok") return refused(requestId, result.kind);
    log.info({ id: result.scene.id }, event);
    return { type: "scenes.result", requestId, ok: true, scene: result.scene, list: list() };
  };

  const importPart = (request: Extract<SceneRequest, { type: "scenes.import" }>): SceneResult => {
    const { requestId, importId, part, parts } = request;
    if (part === 0) {
      discard();
      importing = {
        importId,
        parts,
        next: 0,
        entries: [],
        timer: setTimeout(discard, IMPORT_IDLE_MS),
      };
    }
    const current = importing;
    if (
      !current ||
      current.importId !== importId ||
      current.parts !== parts ||
      current.next !== part
    ) {
      if (current?.importId === importId) discard();
      return refused(requestId, "invalid");
    }
    const issues: SceneIssue[] = [];
    const base = current.entries.length;
    request.scenes.forEach((raw, i) => {
      const parsed = entrySchema.safeParse(raw);
      if (!parsed.success) {
        const index = base + i;
        const name = sceneNameAt(`scenes.${i}`, request);
        for (const issue of issuesFrom(parsed.error, ["scenes", index])) {
          issues.push(name === undefined ? issue : { ...issue, scene: name });
        }
        return;
      }
      const { name, ...definition } = parsed.data;
      current.entries.push({ name, definition });
    });
    if (issues.length > 0) {
      discard();
      return refused(requestId, "invalid", issues.slice(0, 100));
    }
    clearTimeout(current.timer);
    current.next = part + 1;
    if (current.next < parts) {
      current.timer = setTimeout(discard, IMPORT_IDLE_MS);
      return { type: "scenes.result", requestId, ok: true };
    }
    discard();
    const result = store.importAll(current.entries);
    if (result.kind !== "ok") return refused(requestId, result.kind);
    const ids = result.scenes.map((scene) => scene.id);
    log.info({ count: ids.length, ids }, "scenes imported");
    return { type: "scenes.result", requestId, ok: true, list: list() };
  };

  return {
    answer(request) {
      const { requestId } = request;
      switch (request.type) {
        case "scenes.list":
          return { type: "scenes.result", requestId, ok: true, list: list() };
        case "scenes.get": {
          const result = store.get(request.id);
          return result.kind === "ok"
            ? { type: "scenes.result", requestId, ok: true, scene: result.scene }
            : refused(requestId, result.kind);
        }
        case "scenes.save":
          return request.updateId === undefined
            ? written(
                requestId,
                store.save(request.name, request.definition as SceneDefinition),
                "scene saved",
              )
            : written(
                requestId,
                store.update(request.updateId, request.definition as SceneDefinition),
                "scene updated",
              );
        case "scenes.rename":
          return written(requestId, store.rename(request.id, request.name), "scene renamed");
        case "scenes.delete": {
          if (store.remove(request.id).kind === "missing") return refused(requestId, "missing");
          log.info({ id: request.id }, "scene deleted");
          return { type: "scenes.result", requestId, ok: true, list: list() };
        }
        case "scenes.import":
          return importPart(request);
      }
    },
    discard,
  };
}
