import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { HostedGate } from "./auth/SignIn.tsx";
import { createSession, setHostedSession } from "./auth/session.ts";
import { Builder } from "./builder/Builder.tsx";
import { Controller } from "./control/Controller.tsx";
import { readHealth, type PageMode } from "./health.ts";
import { Screen } from "./Screen.tsx";
import { Send } from "./send/Send.tsx";

// Four routes, no router (B-02 PD14, B-04 plan, B-06 T18): the builder at `/builder`, the External
// control page at `/control` and the sending page at `/send` (both served by the LAN listener),
// the output screen everywhere else. B-12 (PD8): the screen and the builder read the mode from
// `/api/health` once before anything renders; a failed read is the local page. Hosted use puts the
// sign-in gate in front of them (SD1). `/control` and `/send` read nothing first: only a local
// install's LAN listener serves them, which answers no `/api/health` (docs/invariants.md), and a
// hosted server answers 404 on both (PD10).
const path = location.pathname;

function pageFor({ mode, cloud, signIn }: PageMode): ReactNode {
  if (mode === "hosted" && signIn) {
    const session = createSession({
      issuer: signIn.issuer,
      clientId: signIn.clientId,
      fetch: (input, init) => fetch(input, init),
      storage: sessionStorage,
      location: {
        origin: location.origin,
        pathname: location.pathname,
        search: location.search,
        assign: (url) => location.assign(url),
      },
      replaceUrl: (url) => history.replaceState(null, "", url),
      now: () => Date.now(),
    });
    setHostedSession(session);
    return (
      <HostedGate session={session}>
        {() => (path === "/builder" ? <Builder /> : <Screen />)}
      </HostedGate>
    );
  }
  return path === "/builder" ? <Builder /> : <Screen cloud={mode === "local" && cloud} />;
}

const root = createRoot(document.getElementById("root")!);
const render = (page: ReactNode) => root.render(<StrictMode>{page}</StrictMode>);
if (path === "/control") render(<Controller />);
else if (path === "/send") render(<Send />);
else void readHealth().then((mode) => render(pageFor(mode)));
