// The hosted sign-in page and gate (B-12 SD16, UI "Hosted sign-in page", PD1, PD9): one "Sign
// in" button; redirecting; "Sign-in failed — try again"; "This account has no access". After a
// return from the provider the gate reads `GET /api/profiles` once with the new token: 403 is
// the not-allowed page, anything else renders the app. Its own scroll container, because the
// page's root hides overflow (web/index.html).
import { useEffect, useState, type ReactNode } from "react";
import type { Session } from "./session.ts";

type GateState = "starting" | "signed_out" | "redirecting" | "failed" | "not_allowed" | "ready";

const admissions = new WeakMap<Session, Promise<GateState>>();

/** Starts the session once per page (StrictMode runs effects twice) and checks the account. */
function admit(session: Session, fetchImpl: typeof fetch): Promise<GateState> {
  let admission = admissions.get(session);
  if (!admission) {
    admission = (async (): Promise<GateState> => {
      const started = await session.start();
      if (started !== "signed_in") return started;
      const token = await session.token();
      if (token === null) return "failed";
      try {
        const response = await fetchImpl("/api/profiles", {
          headers: { authorization: `Bearer ${token}` },
        });
        if (response.status === 403) return "not_allowed";
        if (response.status === 401) return "failed";
      } catch {
        // The page itself reports an unreachable server on its first profile action.
      }
      return "ready";
    })();
    admissions.set(session, admission);
  }
  return admission;
}

const box = {
  height: "100%",
  overflow: "auto",
  boxSizing: "border-box",
  padding: 24,
  color: "#eee",
  fontFamily: "system-ui, sans-serif",
} as const;

export function SignInPage({ line, onSignIn }: { line: string | null; onSignIn?: () => void }) {
  return (
    <main data-testid="sign-in" style={box}>
      <h1 style={{ margin: "0 0 12px", fontSize: 20 }}>DJ Visuals</h1>
      {line && (
        <p data-testid="sign-in-line" role="status" style={{ margin: "0 0 12px" }}>
          {line}
        </p>
      )}
      {onSignIn && (
        <button type="button" data-testid="sign-in-button" onClick={onSignIn}>
          Sign in
        </button>
      )}
    </main>
  );
}

const LINES: Record<Exclude<GateState, "ready" | "signed_out">, string> = {
  starting: "Signing in…",
  redirecting: "Redirecting…",
  failed: "Sign-in failed — try again",
  not_allowed: "This account has no access",
};

export function HostedGate({
  session,
  children,
  fetchImpl = (input, init) => fetch(input, init),
}: {
  session: Session;
  children: () => ReactNode;
  fetchImpl?: typeof fetch;
}) {
  const [state, setState] = useState<GateState>("starting");

  useEffect(() => {
    let live = true;
    void admit(session, fetchImpl).then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [session, fetchImpl]);

  if (state === "ready") return <>{children()}</>;
  const signIn = () => {
    setState("redirecting");
    session.signIn().catch(() => setState("failed"));
  };
  const offersButton = state === "signed_out" || state === "failed";
  return (
    <SignInPage
      line={state === "signed_out" ? null : LINES[state]}
      {...(offersButton ? { onSignIn: signIn } : {})}
    />
  );
}
