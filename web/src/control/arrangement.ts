// The controller's arrangement (B-19 spec SD5, AC12, AC14; plan PD3): the viewport decides it,
// once, in one place. Horizontal — the bank pinned at the bottom with horizontal faders — while the
// viewport is narrower than 600 CSS px and taller than wide; vertical — the bank at the right edge
// with vertical faders — everywhere else (a square viewport too). It is written as
// `data-arrangement` on the page root, which the stylesheet selects on, and the faders read their
// axis from it. Turning or resizing re-lays the page out live; nothing is remembered.
import { useSyncExternalStore } from "react";

export type Arrangement = "horizontal" | "vertical";

export function arrangementFor(width: number, height: number): Arrangement {
  return width < 600 && height > width ? "horizontal" : "vertical";
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

export function useArrangement(): Arrangement {
  return useSyncExternalStore(subscribe, () =>
    arrangementFor(window.innerWidth, window.innerHeight),
  );
}
