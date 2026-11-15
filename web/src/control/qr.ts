// The pairing QR code (B-04 spec SD3; plan T10): `qrcode-generator` encodes the control URL, and
// this draws its modules as one SVG path of unit squares, `size` modules square, for an inline
// `<svg>` in the panel. Error correction M: readable off a screen at an angle. Nothing is drawn on
// the output canvas (AC32): the code is in the panel only, and only while it is open.
import qrcode from "qrcode-generator";

export interface QrPath {
  /** Modules per side. */
  size: number;
  /** One `M x yh1v1h-1z` per dark module. */
  path: string;
}

export function qrPath(text: string, encode: typeof qrcode = qrcode): QrPath {
  const code = encode(0, "M");
  code.addData(text);
  code.make();
  const size = code.getModuleCount();
  let path = "";
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (code.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`;
    }
  }
  return { size, path };
}
