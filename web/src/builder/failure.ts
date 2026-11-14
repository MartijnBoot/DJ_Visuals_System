// One sentence for an API failure, for the builder's lines and notices (B-02 plan T10, T11).
import type { Failure } from "../profiles/api.ts";

export function describeFailure(failure: Failure, doing: string): string {
  switch (failure.kind) {
    case "conflict":
      return failure.conflict.reason === "name_taken"
        ? "that name is taken"
        : `${doing}: this profile was changed elsewhere`;
    case "invalid":
      return failure.issues[0]
        ? `${doing}: ${failure.issues[0].path || "body"}: ${failure.issues[0].message}`
        : `${doing}: the server refused it`;
    case "missing":
      return `${doing}: that profile no longer exists`;
    case "unreachable":
      return `${doing}: the server cannot be reached`;
    case "unsupported_version":
      return "unsupported file version";
    default:
      return `${doing}: the server's answer could not be used`;
  }
}
