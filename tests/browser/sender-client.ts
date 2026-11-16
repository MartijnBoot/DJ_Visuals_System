// A scripted sender for the B-06 browser specs (plan T13), as `deviceClient` is for controllers: a
// page on the LAN origin that runs no app code, pairs on the device socket with what it sends,
// and on `screen { connected: true }` offers a peer connection with the browser's own
// `RTCPeerConnection` and no ICE server. Its media is made here, not taken from the launch
// fixtures every context shares: a canvas of one solid colour no frame of `camera.y4m` has, and a
// 600 Hz tone — the mid band, where the fixture's 60 Hz clicks put nothing. It obeys `stream`
// (pause and resume every encoding) and keeps every message it received, for the assertions.
import type { BrowserContext, Page } from "@playwright/test";
import type { ToDevice } from "../../shared/src/control.ts";
import type { ControlServer } from "./control-server.ts";

/** The sender's picture: far from both camera fixture colours in every channel but red. */
export const SENDER_RGB = [40, 220, 60] as const;
/** In the mid band (150 Hz to 2 kHz); the local fixture's clicks are 60 Hz. */
export const SENDER_TONE_HZ = 600;

type Kind = "video" | "audio";

export interface SenderClient {
  page: Page;
  /** Sends the hello with the code and `sends`; resolves once the request is waiting. */
  request(code: string): Promise<void>;
  waitFor<T extends ToDevice["type"]>(type: T): Promise<Extract<ToDevice, { type: T }>>;
  messages(): Promise<ToDevice[]>;
  /** The current peer connection's state, or "none". */
  peerState(): Promise<string>;
  /** Every peer connection this page made: its ICE servers, as configured. */
  iceServers(): Promise<unknown[][]>;
  /** Stops a track, as a pulled cable or a stopped share does. */
  stopTrack(kind: Kind): Promise<void>;
  /** Drops every candidate from now on, both ways: an unreachable peer (AC13). */
  blockCandidates(): Promise<void>;
}

type SenderWindow = {
  __sender: {
    ws: WebSocket;
    messages: ToDevice[];
    pcs: RTCPeerConnection[];
    tracks: MediaStreamTrack[];
    block: boolean;
  };
};

export async function senderClient(
  context: BrowserContext,
  server: ControlServer,
  sends: Kind[],
): Promise<SenderClient> {
  const page = await context.newPage();
  // As `deviceClient`: the real page with its scripts aborted, so the Origin is right and the
  // document comes from the network (Chromium's Local Network Access, see there).
  await page.route(`${server.lanOrigin}/assets/**`, (route) => route.abort());
  await page.goto(`${server.lanOrigin}/control`);
  // An AudioContext needs a user activation: the media is made in a real click.
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.id = "make-media";
    button.textContent = "make media";
    document.body.append(button);
  });
  await page.evaluate(
    ({ rgb, hz, sends }) => {
      document.querySelector("#make-media")!.addEventListener("click", () => {
        const tracks: MediaStreamTrack[] = [];
        if (sends.includes("video")) {
          const canvas = document.createElement("canvas");
          canvas.width = 320;
          canvas.height = 180;
          const g = canvas.getContext("2d")!;
          const paint = () => {
            g.fillStyle = `rgb(${rgb.join(",")})`;
            g.fillRect(0, 0, canvas.width, canvas.height);
          };
          paint();
          setInterval(paint, 33); // a canvas stream emits frames only when painted
          tracks.push(canvas.captureStream(30).getVideoTracks()[0]!);
        }
        if (sends.includes("audio")) {
          const audio = new AudioContext();
          const tone = audio.createOscillator();
          tone.frequency.value = hz;
          const gain = audio.createGain();
          gain.gain.value = 0.5;
          const out = audio.createMediaStreamDestination();
          tone.connect(gain).connect(out);
          tone.start();
          tracks.push(out.stream.getAudioTracks()[0]!);
        }
        (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks = tracks;
      });
    },
    { rgb: [...SENDER_RGB], hz: SENDER_TONE_HZ, sends },
  );
  await page.click("#make-media");
  await page.evaluate(
    ({ url, sends }) =>
      new Promise<void>((resolve, reject) => {
        const tracks = (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks;
        const ws = new WebSocket(url);
        const state: SenderWindow["__sender"] = { ws, messages: [], pcs: [], tracks, block: false };
        (window as unknown as SenderWindow).__sender = state;
        let pc: RTCPeerConnection | null = null;
        let active: Record<string, boolean> = {};
        const apply = async () => {
          for (const sender of pc?.getSenders() ?? []) {
            const parameters = sender.getParameters();
            const on = active[sender.track?.kind ?? ""] === true;
            for (const e of parameters.encodings ?? []) e.active = on;
            await sender.setParameters(parameters).catch(() => {});
          }
        };
        const offer = async () => {
          pc?.close();
          active = {};
          const next = new RTCPeerConnection({ iceServers: [] });
          pc = next;
          state.pcs.push(next);
          const stream = new MediaStream(tracks);
          for (const track of tracks) {
            next.addTransceiver(track, {
              direction: "sendonly",
              streams: [stream],
              sendEncodings: [{ active: false }],
            });
          }
          next.onicecandidate = (e) => {
            if (!e.candidate || state.block || pc !== next) return;
            const { candidate, sdpMid, sdpMLineIndex } = e.candidate.toJSON();
            ws.send(
              JSON.stringify({
                type: "candidate",
                candidate: candidate ?? "",
                sdpMid: sdpMid ?? null,
                sdpMLineIndex: sdpMLineIndex ?? null,
              }),
            );
          };
          const made = await next.createOffer();
          await next.setLocalDescription(made);
          ws.send(JSON.stringify({ type: "offer", sdp: made.sdp }));
        };
        ws.onmessage = (event) => {
          const message = JSON.parse(String(event.data)) as ToDevice;
          state.messages.push(message);
          if (message.type === "screen") {
            if (message.connected) void offer();
            else {
              pc?.close();
              pc = null;
            }
          } else if (message.type === "answer") {
            void pc?.setRemoteDescription({ type: "answer", sdp: message.sdp }).then(apply);
          } else if (message.type === "candidate" && !state.block) {
            const { candidate, sdpMid, sdpMLineIndex } = message;
            void pc?.addIceCandidate({ candidate, sdpMid, sdpMLineIndex }).catch(() => {});
          } else if (message.type === "stream") {
            active = { ...active, [message.kind]: message.active };
            void apply();
          }
        };
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("sender socket failed"));
        void sends;
      }),
    { url: `wss://127.0.0.1:${server.controlPort}/api/control/device`, sends },
  );
  const waitFor: SenderClient["waitFor"] = async (type) => {
    const handle = await page.waitForFunction(
      (t) => (window as unknown as SenderWindow).__sender.messages.find((m) => m.type === t),
      type,
    );
    return (await handle.jsonValue()) as never;
  };
  return {
    page,
    async request(code) {
      await page.evaluate(
        ({ code, sends }) =>
          (window as unknown as SenderWindow).__sender.ws.send(
            JSON.stringify({ type: "hello", code, sends }),
          ),
        { code, sends },
      );
      await waitFor("waiting");
    },
    waitFor,
    messages: () => page.evaluate(() => (window as unknown as SenderWindow).__sender.messages),
    peerState: () =>
      page.evaluate(
        () => (window as unknown as SenderWindow).__sender.pcs.at(-1)?.connectionState ?? "none",
      ),
    iceServers: () =>
      page.evaluate(() =>
        (window as unknown as SenderWindow).__sender.pcs.map(
          (pc) => pc.getConfiguration().iceServers ?? [],
        ),
      ),
    stopTrack: (kind) =>
      page.evaluate((k) => {
        for (const t of (window as unknown as SenderWindow).__sender.tracks) {
          if (t.kind === k) t.stop();
        }
      }, kind),
    blockCandidates: () =>
      page.evaluate(() => void ((window as unknown as SenderWindow).__sender.block = true)),
  };
}
