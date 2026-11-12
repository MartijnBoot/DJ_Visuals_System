import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Builder } from "./builder/Builder.tsx";
import { Screen } from "./Screen.tsx";

// Two routes, no router (B-02 PD14): the builder at `/builder`, the output screen everywhere else.
const page = location.pathname === "/builder" ? <Builder /> : <Screen />;

createRoot(document.getElementById("root")!).render(<StrictMode>{page}</StrictMode>);
