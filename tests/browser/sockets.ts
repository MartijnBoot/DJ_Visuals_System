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
