// The fader bank (B-19 spec SD1, SD4, SD6, AC12, AC16, AC18; plan T5): pinned to the screen — at
// the bottom with horizontal faders, or at the right edge with vertical faders — so it never
// scrolls away. It takes a list of faders (two today, up to four within SD6's budget); its layout
// is the stylesheet's, keyed off the root's `data-arrangement` only. Locked, every fader is
// disabled with the locked look and the legend row says "Locked" where "Faders" stands, so
// locking never moves a fader.
import { Fader } from "./Fader.tsx";
import type { Arrangement } from "./arrangement.ts";

export interface FaderDefinition {
  testId: string;
  label: string;
  value: number;
  onSend(value: number): void;
  /** B-18 PD9: a stored value to tick on the track. */
  mark?: number;
  /** B-16 PD11: a change lets go of a drag (B-18: the profile an effect fader was shown for). */
  layout?: string;
}

export interface FaderBankProps {
  faders: readonly FaderDefinition[];
  locked: boolean;
  arrangement: Arrangement;
}

export function FaderBank({ faders, locked, arrangement }: FaderBankProps) {
  return (
    <section aria-label="Faders" data-testid="fader-bank" className="djv-bank">
      <div className="djv-bank-legend">
        {locked ? (
          <span data-testid="bank-locked" className="djv-locked-tag">
            Locked
          </span>
        ) : (
          <span className="djv-legend">Faders</span>
        )}
      </div>
      <div className="djv-bank-faders">
        {faders.map((f) => (
          <Fader key={f.testId} {...f} disabled={locked} orientation={arrangement} />
        ))}
      </div>
    </section>
  );
}
