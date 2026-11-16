import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Builder } from "./builder/Builder.tsx";
import { Controller } from "./control/Controller.tsx";
import { Screen } from "./Screen.tsx";
import { Send } from "./send/Send.tsx";

// Four routes, no router (B-02 PD14, B-04 plan, B-06 T18): the builder at `/builder`, the External
// control page at `/control` and the sending page at `/send` (both served by the LAN listener),
// the output screen everywhere else.
const page =
  location.pathname === "/builder" ? (
    <Builder />
  ) : location.pathname === "/control" ? (
    <Controller />
  ) : location.pathname === "/send" ? (
    <Send />
  ) : (
    <Screen />
  );

createRoot(document.getElementById("root")!).render(<StrictMode>{page}</StrictMode>);
