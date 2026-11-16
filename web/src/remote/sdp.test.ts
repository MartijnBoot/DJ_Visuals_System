// T10 (B-06 spec SD20; plan PD11): the one SDP line the system writes, on the shapes Chromium,
// Safari and Firefox write. The fixtures are hand-written in each browser's shape (payload
// types, parameter order, the line before and after), not recorded from a device.
import { describe, expect, it } from "vitest";
import { opusMusic, OPUS_MUSIC } from "./sdp.ts";

const lines = (...l: string[]) => `${l.join("\r\n")}\r\n`;

const chromium = lines(
  "v=0",
  "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0 1",
  "a=msid-semantic: WMS",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126",
  "c=IN IP4 0.0.0.0",
  "a=rtcp:9 IN IP4 0.0.0.0",
  "a=mid:0",
  "a=sendonly",
  "a=rtcp-mux",
  "a=rtpmap:111 opus/48000/2",
  "a=rtcp-fb:111 transport-cc",
  "a=fmtp:111 minptime=10;useinbandfec=1",
  "a=rtpmap:63 red/48000/2",
  "a=fmtp:63 111/111",
  "a=rtpmap:9 G722/8000",
  "m=video 9 UDP/TLS/RTP/SAVPF 96 97",
  "c=IN IP4 0.0.0.0",
  "a=mid:1",
  "a=rtpmap:96 VP8/90000",
  "a=rtpmap:97 rtx/90000",
  "a=fmtp:97 apt=96",
);

const safari = lines(
  "v=0",
  "o=- 2787145298375462741 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111 63 103 9 102 0 8 105 13 110 113 126",
  "c=IN IP4 0.0.0.0",
  "a=mid:0",
  "a=sendrecv",
  "a=rtpmap:111 OPUS/48000/2",
  "a=rtcp-fb:111 transport-cc",
  "a=fmtp:111 useinbandfec=1;minptime=10",
  "a=rtpmap:103 ISAC/16000",
);

const firefox = lines(
  "v=0",
  "o=mozilla...THIS_IS_SDPARTA-99.0 7210396939318633226 0 IN IP4 0.0.0.0",
  "s=-",
  "t=0 0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 109 9 0 8 101",
  "c=IN IP4 0.0.0.0",
  "a=sendonly",
  "a=fmtp:109 maxplaybackrate=48000;stereo=1;useinbandfec=1",
  "a=fmtp:101 0-15",
  "a=mid:0",
  "a=rtpmap:109 opus/48000/2",
  "a=rtpmap:9 G722/8000/1",
  "a=rtpmap:101 telephone-event/8000/1",
);

const changed = (before: string, after: string) => {
  const a = before.split("\r\n");
  const b = after.split("\r\n");
  expect(b).toHaveLength(a.length);
  return a.flatMap((line, i) => (line === b[i] ? [] : [[line, b[i]!]]));
};

const params = (fmtp: string) => fmtp.replace(/^a=fmtp:\d+ /, "").split(";");

describe("opusMusic (PD11)", () => {
  it("is the four parameters SD20 asks for", () => {
    expect(OPUS_MUSIC).toEqual({
      stereo: "1",
      "sprop-stereo": "1",
      maxaveragebitrate: "128000",
      usedtx: "0",
    });
  });

  it.each([
    ["Chromium", chromium, "111"],
    ["Safari", safari, "111"],
    ["Firefox", firefox, "109"],
  ])("on %s's shape adds them once to the Opus fmtp line and changes no other", (_, sdp, pt) => {
    const out = opusMusic(sdp);
    const diff = changed(sdp, out);
    expect(diff).toHaveLength(1);
    const [before, after] = diff[0]!;
    expect(before.startsWith(`a=fmtp:${pt} `)).toBe(true);
    const list = params(after);
    for (const p of ["stereo=1", "sprop-stereo=1", "maxaveragebitrate=128000", "usedtx=0"]) {
      expect(list.filter((x) => x === p)).toHaveLength(1);
    }
    // Every parameter that was there is still there, in its place.
    expect(list.slice(0, params(before).length).map((x) => x.split("=")[0])).toEqual(
      params(before).map((x) => x.split("=")[0]),
    );
    expect(out.endsWith("\r\n")).toBe(true);
  });

  it("is idempotent", () => {
    expect(opusMusic(opusMusic(chromium))).toBe(opusMusic(chromium));
  });

  it("overrides a different value of one of the four in its place", () => {
    const sdp = lines("m=audio 9 RTP/AVP 111", "a=rtpmap:111 opus/48000/2", "a=fmtp:111 usedtx=1");
    expect(opusMusic(sdp)).toBe(
      lines(
        "m=audio 9 RTP/AVP 111",
        "a=rtpmap:111 opus/48000/2",
        "a=fmtp:111 usedtx=0;stereo=1;sprop-stereo=1;maxaveragebitrate=128000",
      ),
    );
  });

  it("adds an fmtp line after the rtpmap when Opus has none", () => {
    const sdp = lines("m=audio 9 RTP/AVP 111", "a=rtpmap:111 opus/48000/2", "a=mid:0");
    expect(opusMusic(sdp)).toBe(
      lines(
        "m=audio 9 RTP/AVP 111",
        "a=rtpmap:111 opus/48000/2",
        "a=fmtp:111 stereo=1;sprop-stereo=1;maxaveragebitrate=128000;usedtx=0",
        "a=mid:0",
      ),
    );
  });

  it("returns its input when there is no Opus line", () => {
    const video = lines("v=0", "m=video 9 UDP/TLS/RTP/SAVPF 96", "a=rtpmap:96 VP8/90000");
    expect(opusMusic(video)).toBe(video);
    expect(opusMusic("")).toBe("");
  });

  it("keeps \\n line endings when the input uses them", () => {
    const sdp = "m=audio 9 RTP/AVP 111\na=rtpmap:111 opus/48000/2\na=fmtp:111 minptime=10\n";
    expect(opusMusic(sdp)).toBe(
      "m=audio 9 RTP/AVP 111\na=rtpmap:111 opus/48000/2\n" +
        "a=fmtp:111 minptime=10;stereo=1;sprop-stereo=1;maxaveragebitrate=128000;usedtx=0\n",
    );
  });
});
