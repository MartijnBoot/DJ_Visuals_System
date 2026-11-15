// The controller's look (B-04 spec UI, Non-functional): large touch targets (at least 48×48 CSS
// px), white or near-white text on near-black, the active choice in black on amber — every pair
// at least 4.5:1. No horizontal scrolling at 320 CSS px: everything wraps.
import type { CSSProperties } from "react";

const TARGET = 48;
export const AMBER = "#f5c518";

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
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
    gap: 8,
  },
  heading: { margin: 0, fontSize: 14, fontWeight: 600, color: "#ddd" },
  button,
  tile: { ...button, overflowWrap: "anywhere", textAlign: "left" },
  active: { ...button, color: "#000", background: AMBER, borderColor: AMBER, fontWeight: 700 },
  badge: { ...button, color: "#000", background: AMBER, borderColor: AMBER, fontWeight: 700 },
  slider: { width: "100%", minHeight: TARGET, margin: 0, accentColor: AMBER },
  input: {
    ...button,
    background: "#000",
    letterSpacing: 4,
    textTransform: "uppercase",
    width: "8em",
  },
  list: { margin: 0, padding: 0, listStyle: "none" },
  request: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
    justifyContent: "space-between",
  },
  dialog: {
    color: "#fff",
    background: "#1b1b1b",
    border: "1px solid #777",
    borderRadius: 12,
    maxWidth: "min(480px, calc(100vw - 32px))",
    boxSizing: "border-box",
  },
  note: { color: "#ccc", fontSize: 14 },
} satisfies Record<string, CSSProperties>;
