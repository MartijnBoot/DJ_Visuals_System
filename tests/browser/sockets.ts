// A Wi-Fi drop as a controller's page sees one (D-17). Going offline in Playwright does not end a
// socket that is already open, and `ws.close()` only starts a close handshake: the page hears
// `close` once the server answers, which on CI once took more than 5 s. A real drop never gets
// that far — the page learns of it as an abnormal close. So the drop also hands every socket an
// abnormal close (1006) at once, and the real one, whenever it comes, is for a socket the page has
// already let go of. No test code ships in the page.
import type { BrowserContext, Page } from "@playwright/test";

type SocketWindow = { __sockets: WebSocket[] };

/** Keeps every WebSocket the context's pages open reachable, so a test can drop them. */
export async function keepSockets(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const Base = window.WebSocket;
    const all: WebSocket[] = [];
    (window as unknown as SocketWindow).__sockets = all;
    window.WebSocket = class extends Base {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        all.push(this);
      }
    };
  });
}

/**
 * Ends the page's link as a Wi-Fi drop would: the network offline, and every socket it holds
 * closed abnormally at once, without waiting for a close handshake. The page needs `keepSockets`.
 */
export async function dropNetwork(page: Page): Promise<void> {
  await page.context().setOffline(true);
  await page.evaluate(() => {
    for (const ws of (window as unknown as SocketWindow).__sockets) {
      if (ws.readyState === WebSocket.CLOSED) continue; // its close was heard already
      ws.close();
      ws.dispatchEvent(new CloseEvent("close", { code: 1006, wasClean: false }));
    }
  });
}

/** One frame a page put on a socket: when `send` returned (page clock) and the message. */
export interface SentFrame {
  t: number;
  message: { type: string } & Record<string, unknown>;
}

type SendWindow = { __sends: SentFrame[] };

/**
 * B-16 PD16: stamps every frame the context's pages send inside `WebSocket.prototype.send`, on the
 * page's own clock, so the send budget's gaps are measured where they are kept, with no tolerance.
 */
export async function recordSends(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const w = window as unknown as SendWindow;
    w.__sends = [];
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      send.call(this, data);
      w.__sends.push({
        t: performance.now(),
        message: JSON.parse(String(data)) as SentFrame["message"],
      });
    };
  });
}

/** Every frame recorded so far. */
export const sentFrames = (page: Page): Promise<SentFrame[]> =>
  page.evaluate(() => (window as unknown as SendWindow).__sends);

/** The page's clock now, to compare with `SentFrame.t`. */
export const pageNow = (page: Page): Promise<number> => page.evaluate(() => performance.now());

/**
 * Arms a mark, on the page's clock, for the first moment one of its sockets hears `close`: the
 * link locks right there, so a frame stamped after it was sent after the lock. Needs
 * `keepSockets`; returns a reader for the mark (Infinity until a close).
 */
export async function markClose(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const w = window as unknown as SocketWindow & { __closedAt?: number };
    w.__closedAt = Infinity;
    for (const ws of w.__sockets) {
      ws.addEventListener(
        "close",
        () => (w.__closedAt = Math.min(w.__closedAt!, performance.now())),
        {
          once: true,
        },
      );
    }
  });
  return () => page.evaluate(() => (window as unknown as { __closedAt: number }).__closedAt);
}
