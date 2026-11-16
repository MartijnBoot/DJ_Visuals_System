// The one SDP line the system writes (B-06 spec SD20; plan PD11): Opus for music — stereo,
// 128 kb/s, no DTX — on the Opus `fmtp` line. The sender applies it to its offer and the screen
// to its answer, before `setLocalDescription`; the answer's line is what tells the sender it may
// encode stereo. Nothing else in an SDP is read or changed.

export const OPUS_MUSIC: Readonly<Record<string, string>> = {
  stereo: "1",
  "sprop-stereo": "1",
  maxaveragebitrate: "128000",
  usedtx: "0",
};

const RTPMAP = /^a=rtpmap:(\d+) opus\/48000/i;

export function opusMusic(sdp: string): string {
  const eol = sdp.includes("\r\n") ? "\r\n" : "\n";
  const lines = sdp.split(eol);
  const rtpmap = lines.findIndex((l) => RTPMAP.test(l));
  if (rtpmap === -1) return sdp;
  const pt = RTPMAP.exec(lines[rtpmap]!)![1]!;
  const prefix = `a=fmtp:${pt} `;
  const fmtp = lines.findIndex((l) => l.startsWith(prefix));
  const existing = fmtp === -1 ? [] : lines[fmtp]!.slice(prefix.length).split(";");
  const params = existing.filter((p) => p.length > 0).map((p) => p.split("=") as [string, string?]);
  for (const [name, value] of Object.entries(OPUS_MUSIC)) {
    const at = params.findIndex(([n]) => n === name);
    if (at === -1) params.push([name, value]);
    else params[at] = [name, value];
  }
  const line = prefix + params.map(([n, v]) => (v === undefined ? n : `${n}=${v}`)).join(";");
  if (fmtp === -1) lines.splice(rtpmap + 1, 0, line);
  else lines[fmtp] = line;
  return lines.join(eol);
}
