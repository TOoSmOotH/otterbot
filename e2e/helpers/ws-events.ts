import type { Page } from "@playwright/test";

/**
 * Set up an event collector that creates its own Socket.IO connection
 * to the server. Events are stored on window.__e2eEvents and retrieved
 * via page.evaluate().
 *
 * The app's internal socket is a module-level singleton (not exposed on
 * window), so we load the socket.io-client from the app's own bundle
 * and open a second connection for event collection.
 */
export async function setupEventCollector(page: Page): Promise<void> {
  await page.evaluate(() => {
    const win = window as any;
    win.__e2eEvents = {};
    win.__e2eSocketReady = false;

    const EVENTS = [
      "project:created",
      "project:updated",
      "project:deleted",
      "agent:spawned",
      "agent:status",
      "agent:destroyed",
      "agent:tool-call",
      "agent:stream",
      "bus:message",
      "coo:response",
      "coo:stream",
      "kanban:task-created",
      "kanban:task-updated",
      "kanban:task-deleted",
    ];

    function attachListeners(socket: any) {
      for (const event of EVENTS) {
        win.__e2eEvents[event] = win.__e2eEvents[event] || [];
        socket.on(event, (data: any) => {
          win.__e2eEvents[event].push(structuredClone(data));
        });
      }
      win.__e2eSocketReady = true;
    }

    // Try to find existing socket — the app may expose it in various ways
    if (win.__socket) {
      attachListeners(win.__socket);
      return;
    }

    // Intercept Socket.IO by monkey-patching the io() factory.
    // The app's socket.io-client is bundled and called via io().
    // We intercept the WebSocket constructor to find established connections.

    // Alternative: create our own Socket.IO connection using the bundled client.
    // We can import it dynamically from the app's assets.
    const script = document.createElement("script");
    script.src = "/socket.io/socket.io.js"; // Socket.IO auto-serves this
    script.onload = () => {
      const ioClient = (win as any).io;
      if (!ioClient) {
        console.error("[e2e] socket.io client not available");
        return;
      }
      const socket = ioClient(window.location.origin, {
        transports: ["websocket", "polling"],
        withCredentials: true,
      });
      socket.on("connect", () => {
        console.log("[e2e] Event collector connected");
      });
      attachListeners(socket);
      win.__e2eSocket = socket;
    };
    document.head.appendChild(script);
  });

  // Wait for the socket to be ready
  const start = Date.now();
  while (Date.now() - start < 15_000) {
    const ready = await page.evaluate(() => (window as any).__e2eSocketReady);
    if (ready) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  console.warn("[e2e] Event collector socket not ready after 15s — continuing anyway");
}

/**
 * Wait for a specific event that matches a predicate.
 * Polls page.evaluate() in a loop until the event appears or timeout.
 */
export async function waitForEvent(
  page: Page,
  event: string,
  predicate: (data: any) => boolean,
  timeoutMs: number,
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const match = await page.evaluate(
      ({ event, fnStr }) => {
        const win = window as any;
        const events: any[] = win.__e2eEvents?.[event] ?? [];
        // Evaluate the predicate string as a function
        const fn = new Function("data", `return (${fnStr})(data)`);
        return events.find((e) => fn(e)) ?? null;
      },
      { event, fnStr: predicate.toString() },
    );
    if (match) return match;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`Timed out waiting for event "${event}" after ${timeoutMs}ms`);
}

/**
 * Get all collected events for a given event name.
 */
export async function getEvents(page: Page, event: string): Promise<any[]> {
  return page.evaluate((evt) => {
    return (window as any).__e2eEvents?.[evt] ?? [];
  }, event);
}
