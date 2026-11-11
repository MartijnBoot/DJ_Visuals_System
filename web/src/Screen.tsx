// The one route, `/` (spec UI): a full-window canvas running the engine, no chrome. If the
// engine cannot get a WebGL2 context, one line of text takes the canvas's place.
import { createEngine, type Engine } from "@djv/engine";
import { useEffect, useRef, useState } from "react";

export function Screen() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (error) {
    return (
      <p data-testid="engine-error" style={{ color: "#fff", fontFamily: "monospace", margin: 16 }}>
        {error}
      </p>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      data-testid="screen"
      style={{ display: "block", width: "100vw", height: "100vh" }}
    />
  );
}
