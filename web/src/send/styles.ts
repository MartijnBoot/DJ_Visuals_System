// The sending page's look (B-06 spec UI "Sender"; B-19 spec SD8, plan PD12): today's values, copied
// from the controller's former style module so `/send` keeps its look while `/control` gets its
// own. Large touch targets (at least 48×48 CSS px), near-white text on near-black, every pair at
// least 4.5:1. No horizontal scrolling at 320 CSS px: everything wraps.
import type { CSSProperties } from "react";

const TARGET = 48;

const button: CSSProperties = {
  minWidth: TARGET,
  minHeight: TARGET,
  padding: "8px 14px",
  font: "inherit",
  color: "#fff",
  background: "#2a2a2a",
  border: "1px solid #777",
  borderRadius: 8,
  cursor: "pointer",
  boxSizing: "border-box",
};

export const styles = {
  page: {
    position: "fixed",
    inset: 0,
    overflowY: "auto",
    overflowX: "hidden",
    color: "#fff",
    background: "#111",
    font: "16px/1.4 system-ui, sans-serif",
  },
  column: {
    display: "grid",
    gap: 16,
    padding: 12,
    maxWidth: 900,
    margin: "0 auto",
    boxSizing: "border-box",
  },
  linkLine: {
    padding: "10px 12px",
    borderRadius: 8,
    background: "#222",
    fontWeight: 600,
    overflowWrap: "anywhere",
  },
  row: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" },
  heading: { margin: 0, fontSize: 14, fontWeight: 600, color: "#ddd" },
  button,
  input: {
    ...button,
    background: "#000",
    letterSpacing: 4,
    textTransform: "uppercase",
    width: "8em",
  },
  note: { color: "#ccc", fontSize: 14 },
} satisfies Record<string, CSSProperties>;
