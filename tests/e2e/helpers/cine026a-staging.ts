import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * CINE-026-A shared hosted-staging helpers. Same project guard and ownership-checked cleanup as
 * cine026-staging.spec.ts. Nothing here records tokens, cookies, room ids, room codes or names.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { loadHostedStaging, assertEmptyHostedApplication } = require("../../hosted-supabase/environment.cjs") as {
  loadHostedStaging: () => { project: string; pgConfig: Record<string, unknown> };
  assertEmptyHostedApplication: (db: Pool) => Promise<void>;
};

export const staging = loadHostedStaging();
export const ORIGIN = process.env.CINE026A_ORIGIN ?? "http://127.0.0.1:3065";
export const RUN = "C026A-" + randomUUID().slice(0, 8);
export const createdRoomIds = new Set<string>();
export const db = new Pool({ ...staging.pgConfig, max: 1, connectionTimeoutMillis: 10000, statement_timeout: 10000 });
export const MATRIX_FIDELITY = process.env.CINE026A_FIDELITY === "1";
/** Video recording alone (no redaction script), to isolate which production-spec context option breaks init scripts. */
/** Production-spec blur redaction init script alone. */
export const BLUR_REDACTION = MATRIX_FIDELITY || process.env.CINE026A_BLUR === "1";
export const RECORD_VIDEO = MATRIX_FIDELITY || process.env.CINE026A_VIDEO === "1";

export type Ev = { t: number; kind: string; detail: Record<string, unknown> };
export type Client = { context: BrowserContext; page: Page; label: string; events: Ev[] };

export async function assertStagingReady() {
  expect(staging.project).toBe("dmrbticnsczhyaiftrar");
  await assertEmptyHostedApplication(db);
}

export async function cleanupStaging() {
  try {
    const ids = [...createdRoomIds];
    if (ids.length === 0) return;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const owned = await client.query(
        `SELECT r.id FROM public.rooms r
          WHERE r.id = ANY($1::uuid[]) AND r.created_at >= NOW() - INTERVAL '8 hours'
            AND EXISTS (SELECT 1 FROM public.room_participants p WHERE p.room_id = r.id AND p.display_name LIKE $2)`,
        [ids, RUN + "-%"]
      );
      if (owned.rowCount !== ids.length) throw new Error("Staging cleanup refused: a room is not owned by this CINE-026-A run.");
      const expired = await client.query(
        `UPDATE public.rooms SET status = 'EXPIRED', expires_at = NOW() - INTERVAL '1 second'
          WHERE id = ANY($1::uuid[])
            AND EXISTS (SELECT 1 FROM public.room_participants p WHERE p.room_id = public.rooms.id AND p.display_name LIKE $2)`,
        [ids, RUN + "-%"]
      );
      if (expired.rowCount !== ids.length) throw new Error("Staging cleanup refused: exact run-owned room expiration count did not match.");
      const deleted = await client.query("DELETE FROM public.rooms WHERE id = ANY($1::uuid[])", [ids]);
      if (deleted.rowCount !== ids.length) throw new Error("Staging cleanup refused: exact room deletion count did not match this run.");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    createdRoomIds.clear();
  } finally {
    await db.end();
  }
}

export async function makeContext(browser: Browser, options: { proxy?: { server: string; bypass?: string } } = {}): Promise<BrowserContext> {
  const context = await browser.newContext({ ...(RECORD_VIDEO ? { recordVideo: { dir: "test-results/cine026a-video" } } : {}), ...(options.proxy ? { proxy: options.proxy } : {}) });
  if (BLUR_REDACTION) {
    await context.addInitScript(() => {
      const redact = () => {
        if (!document.head || document.getElementById("cine026-video-redaction")) return;
        const style = document.createElement("style");
        style.id = "cine026-video-redaction";
        style.textContent = '[data-testid="cm-room-code"], [data-testid="cine024-voting-panel"] header p { filter: blur(10px) !important; }';
        document.head.append(style);
      };
      // document (always a Node) rather than document.documentElement (null when init scripts run): observing null
    // threw, and WebKit evaluates every init script as one bootstrap, so the throw also skipped later hooks.
    new MutationObserver(redact).observe(document, { childList: true, subtree: true });
      redact();
    });
  }
  await context.addInitScript(() => {
    const state: { progress: Array<{ t: number; text: string }> } = { progress: [] };
    (window as unknown as { __cm?: typeof state }).__cm = state;
    let last: string | null = null;
    const sample = () => {
      const text = document.querySelector('[data-testid="cine024-progress"]')?.textContent?.trim() ?? null;
      if (text !== null && text !== last) { last = text; state.progress.push({ t: Date.now(), text }); }
    };
    new MutationObserver(sample).observe(document, { subtree: true, childList: true, characterData: true });
  });
  return context;
}

export function observe(client: Client, roomId: string) {
  const { page, events } = client;
  page.on("pageerror", (error) => events.push({ t: Date.now(), kind: "pageerror", detail: { message: error.message.slice(0, 160) } }));
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname !== "/realtime/v1/websocket") return;
    events.push({ t: Date.now(), kind: "ws-open", detail: {} });
    socket.on("close", () => events.push({ t: Date.now(), kind: "ws-close", detail: {} }));
    socket.on("framereceived", ({ payload }) => {
      const frame = decodeFrame(payload);
      const hint = frame?.hint;
      if (frame?.event === "room_changed" && hint?.roomId === roomId && Number.isSafeInteger(hint.version)) {
        events.push({ t: Date.now(), kind: "ws-hint", detail: { version: hint.version } });
      }
    });
  });
  page.on("response", (response) => {
    const request = response.request();
    const url = new URL(response.url());
    if (request.method() === "GET" && url.pathname === `/api/rooms/${roomId}`) {
      const t = Date.now();
      void response.json().then((body: { room?: { stateVersion?: number; currentCandidateIndex?: number | null } }) => {
        events.push({ t, kind: "snapshot-get", detail: { status: response.status(), version: body.room?.stateVersion, index: body.room?.currentCandidateIndex } });
      }).catch(() => events.push({ t, kind: "snapshot-get", detail: { status: response.status() } }));
    }
  });
}

export function decodeFrame(message: string | Buffer): { event?: string; hint?: { roomId?: string; version?: number } } | null {
  try {
    if (typeof message === "string") {
      const decoded = JSON.parse(message) as unknown;
      if (Array.isArray(decoded) && decoded.length >= 5) {
        const payload = decoded[4] as { event?: string; payload?: { roomId?: string; version?: number } };
        return { event: payload.event, hint: payload.payload };
      }
      return null;
    }
    if (message.length >= 5 && message[0] === 4) {
      const topicLength = message[1]!;
      const eventLength = message[2]!;
      const metadataLength = message[3]!;
      const encoding = message[4]!;
      const eventStart = 5 + topicLength;
      const event = message.subarray(eventStart, eventStart + eventLength).toString("utf8");
      const body = encoding === 1 ? (JSON.parse(message.subarray(eventStart + eventLength + metadataLength).toString("utf8")) as { roomId?: string; version?: number }) : undefined;
      return { event, hint: body };
    }
  } catch { /* non-JSON or unrelated frame */ }
  return null;
}

export async function makeRoom(browser: Browser, count: number, options: { proxyFor?: number[]; proxy?: { server: string; bypass?: string }; prepare?: (context: BrowserContext, index: number) => Promise<void> } = {}) {
  const contexts = await Promise.all(Array.from({ length: count }, (_, index) => makeContext(browser, options.proxyFor?.includes(index) ? { proxy: options.proxy } : {})));
  if (options.prepare) await Promise.all(contexts.map((context, index) => options.prepare!(context, index)));
  const create = await contexts[0]!.request.post(`${ORIGIN}/api/rooms`, { headers: { origin: ORIGIN }, data: { displayName: RUN + "-host", deckFilter: { with_keywords: "999995" } } });
  expect(create.status()).toBe(201);
  const created = await create.json();
  const roomId = created.room.roomId as string;
  createdRoomIds.add(roomId);
  for (let index = 1; index < count; index += 1) {
    const joined = await contexts[index]!.request.post(`${ORIGIN}/api/rooms/join`, { headers: { origin: ORIGIN }, data: { code: created.room.code, displayName: `${RUN}-p${index + 1}` } });
    expect(joined.status()).toBe(200);
  }
  const clients: Client[] = [];
  for (let index = 0; index < count; index += 1) {
    const page = await contexts[index]!.newPage();
    const client: Client = { context: contexts[index]!, page, label: `c${index}`, events: [] };
    observe(client, roomId);
    clients.push(client);
  }
  await Promise.all(clients.map(async (client) => {
    await client.page.goto(`/cinematch/room/${roomId}`);
    await expect(client.page.getByTestId("cm-participant-count")).toHaveText(`${count} / 5`, { timeout: 30000 });
  }));
  return { clients, roomId };
}

export async function startVoting(clients: Client[]) {
  await expect(clients[0]!.page.getByTestId("cm-start-round")).toBeEnabled();
  await clients[0]!.page.getByTestId("cm-start-round").click();
  await Promise.all(clients.map((c) => expect(c.page.getByTestId("cm-continue-voting")).toBeVisible({ timeout: 30000 })));
  await Promise.all(clients.map(async (c) => {
    await c.page.getByTestId("cm-continue-voting").click();
    await expect(c.page.getByTestId("cine024-progress")).toHaveText("Card 01 / 20", { timeout: 30000 });
    await expect(c.page.getByTestId("cm-connection-banner")).toContainText("Live: Realtime room channel connected", { timeout: 30000 });
  }));
}

export async function vote(client: Client, roomId: string, choice: "LIKE" | "SKIP") {
  const responsePromise = client.page.waitForResponse((response) => new URL(response.url()).pathname === `/api/rooms/${roomId}/votes` && response.request().method() === "POST");
  await client.page.getByTestId(choice === "LIKE" ? "cine024-like" : "cine024-skip").click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const body = await response.json() as { isMatched: boolean; room: { status: string; currentCandidateIndex: number | null; stateVersion: number } };
  client.events.push({ t: Date.now(), kind: "vote-response", detail: { choice, version: body.room.stateVersion, index: body.room.currentCandidateIndex } });
  return body;
}

export async function closeAll(clients: Client[]) {
  await Promise.all(clients.map((client) => client.context.close().catch(() => undefined)));
}
