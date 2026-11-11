// The one route, `/` (spec UI): a full-window canvas running the engine, no chrome. If the
// engine cannot get a WebGL2 context, one line of text takes the canvas's place. The `o` key,
// with no modifier, toggles the overlay (spec SD14, AC12); it is hidden on load.
import { createEngine, type Engine } from "@djv/engine";
import { useCallback, useEffect, useRef, useState } from "react";
import { Overlay } from "./Overlay.tsx";

export function Screen() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let engine: Engine;
    try {
      engine = createEngine(canvas);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    engineRef.current = engine;
    engine.start();
    return () => {
      engine.stop();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "o" || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      setOverlay((shown) => !shown);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const stats = useCallback(() => engineRef.current?.stats() ?? null, []);

  return (
    <>
      {error ? (
        <p
          data-testid="engine-error"
          style={{ color: "#fff", fontFamily: "monospace", margin: 16 }}
        >
          {error}
        </p>
      ) : (
        <canvas
          ref={canvasRef}
          data-testid="screen"
          style={{ display: "block", width: "100vw", height: "100vh" }}
        />
      )}
      {overlay && <Overlay stats={stats} />}
    </>
  );
}
