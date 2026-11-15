import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Builder } from "./builder/Builder.tsx";
import { Controller } from "./control/Controller.tsx";
import { Screen } from "./Screen.tsx";

// Three routes, no router (B-02 PD14, B-04 plan): the builder at `/builder`, the External control
// page at `/control` (served by the LAN listener), the output screen everywhere else.
const page =
  location.pathname === "/builder" ? (
    <Builder />
  ) : location.pathname === "/control" ? (
    <Controller />
  ) : (
    <Screen />
  );

createRoot(document.getElementById("root")!).render(<StrictMode>{page}</StrictMode>);
