import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  subscribe: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock("@/lib/realtime/roomRealtime", () => ({
  startRoomRealtime: (...args: unknown[]) => runtime.subscribe(...args),
}));

vi.mock("@/lib/realtime/roomActions", () => ({
  createRoomActions: () => ({
    vote: vi.fn(async () => ({ ok: true, replayed: false, data: {} })),
  }),
}));

vi.mock("@/components/cinematch/CineMatchPrimitives", () => ({
  CineMatchAlertCard: ({ message }: { message: string }) => <p>{message}</p>,
}));

vi.mock("@/components/cinematch/voting/CineMatchVotingPanel", () => ({
  CineMatchVotingPanel: ({ snapshot, onResync }: {
    snapshot: { room: { code: string; participants: Array<{ displayName: string }>; currentCandidate: { title: string } }; viewer: { userVotes: Record<string, string> } } | null;
    onResync: () => Promise<unknown>;
  }) => (
    <section data-testid="voting-data">
      {snapshot ? (
        <div>
          <span>{snapshot.room.code}</span>
          <span>{snapshot.room.currentCandidate.title}</span>
          <span>{snapshot.room.participants[0].displayName}</span>
          <span>{JSON.stringify(snapshot.viewer.userVotes)}</span>
        </div>
      ) : <span>Snapshot unavailable</span>}
      <button type="button" onClick={() => void onResync().catch(() => undefined)}>Refresh snapshot</button>
    </section>
  ),
}));

vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://unit-example.supabase.co");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "unit-public-key");

const { CineMatchVotingClient } = await import("@/components/cinematch/voting/CineMatchVotingClient");

function exampleSnapshot(version = 1) {
  return {
    room: {
      roomId: "cine024-auth-room",
      stateVersion: version,
      status: "ACTIVE",
      code: "PRIVATE24",
      currentCandidate: { candidateId: "candidate-one", title: "Sensitive Candidate" },
      participants: [{ displayName: "Private Guest" }],
    },
    viewer: { participantId: "guest-1", isEligibleVoter: true, userVotes: { earlier: "LIKE" } },
  };
}

type CallbackSet = {
  onSnapshot: (snapshot: ReturnType<typeof exampleSnapshot>) => void;
  onStatus: (status: "live" | "closed") => void;
  onError: (error: Error) => void;
};

function httpReply(status: number, data?: object) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data ?? { error: "ROOM_ACCESS_REFUSED" },
  };
}

let handlers: CallbackSet[] = [];
let closeCalls = 0;

beforeEach(() => {
  handlers = [];
  closeCalls = 0;
  runtime.mockFetch.mockReset();
  runtime.subscribe.mockReset();
  vi.stubGlobal("fetch", runtime.mockFetch);
  runtime.subscribe.mockImplementation(async (config: CallbackSet) => {
    handlers.push(config);
    config.onSnapshot(exampleSnapshot());
    config.onStatus("live");
    const handle = Object.assign(
      async () => { closeCalls++; },
      { resync: async () => undefined, accept: () => true, status: () => "live" },
    );
    return handle;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openProtectedRoom() {
  render(<CineMatchVotingClient roomId="cine024-auth-room" />);
  await waitFor(() => expect(screen.getByText("Sensitive Candidate")).toBeTruthy());
  expect(screen.getByText("PRIVATE24")).toBeTruthy();
  expect(screen.getByText("Private Guest")).toBeTruthy();
  expect(screen.getByText('{"earlier":"LIKE"}')).toBeTruthy();
}

function privateContentHidden() {
  expect(screen.queryByText("Sensitive Candidate")).toBeNull();
  expect(screen.queryByText("PRIVATE24")).toBeNull();
  expect(screen.queryByText("Private Guest")).toBeNull();
  expect(screen.queryByText('{"earlier":"LIKE"}')).toBeNull();
  expect(screen.queryByTestId("voting-data")).toBeNull();
  expect(screen.getByTestId("cine024-access-revoked")).toBeTruthy();
}

describe("CINE-024 private room revocation (real voting client, mocked transport)", () => {
  it.each([401, 403, 410])("clears protected candidate/roster/viewer vote on HTTP %i from authenticated GET", async (status) => {
    await openProtectedRoom();
    runtime.mockFetch.mockResolvedValueOnce(httpReply(status));
    fireEvent.click(screen.getByRole("button", { name: "Refresh snapshot" }));
    await waitFor(() => privateContentHidden());
    expect(screen.getByRole("link", { name: "Return to CineMatch" }).getAttribute("href")).toBe("/cinematch");
    expect(closeCalls).toBeGreaterThanOrEqual(1);
  });

  it("permanent private realtime error revokes access and ignores old websocket snapshots", async () => {
    await openProtectedRoom();
    const old = handlers[0];
    await act(async () => {
      old.onError(Object.assign(new Error("Session revoked"), { permanent: true, status: 403 }));
    });
    await waitFor(() => privateContentHidden());
    await act(async () => {
      old.onSnapshot(exampleSnapshot(99));
      old.onStatus("live");
    });
    privateContentHidden();
  });

  it("drops a stale authorized GET completing after realtime revocation", async () => {
    await openProtectedRoom();
    let resolveOld!: (response: ReturnType<typeof httpReply>) => void;
    runtime.mockFetch.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh snapshot" }));
    await waitFor(() => expect(runtime.mockFetch).toHaveBeenCalledTimes(1));
    await act(async () => {
      handlers[0].onError(Object.assign(new Error("Revoked"), { permanent: true, status: 401 }));
    });
    privateContentHidden();
    await act(async () => { resolveOld(httpReply(200, exampleSnapshot(123))); });
    privateContentHidden();
  });

  it("requires explicit fresh authenticated GET before reauthorizing and rebuilding realtime", async () => {
    await openProtectedRoom();
    const prior = handlers[0];
    await act(async () => {
      prior.onStatus("closed");
    });
    privateContentHidden();
    // A stray earlier snapshot cannot restore protected content by itself.
    await act(async () => { prior.onSnapshot(exampleSnapshot(200)); });
    privateContentHidden();

    runtime.mockFetch.mockResolvedValueOnce(httpReply(401));
    fireEvent.click(screen.getByRole("button", { name: "Verify current room access" }));
    await waitFor(() => expect(runtime.mockFetch).toHaveBeenCalledTimes(1));
    await waitFor(() => privateContentHidden());

    runtime.mockFetch.mockResolvedValueOnce(httpReply(200, exampleSnapshot(3)));
    fireEvent.click(screen.getByRole("button", { name: "Verify current room access" }));
    await waitFor(() => expect(runtime.mockFetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(runtime.subscribe).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("Sensitive Candidate")).toBeTruthy());
    await act(async () => { prior.onSnapshot(exampleSnapshot(999)); });
    expect(screen.getByText("PRIVATE24")).toBeTruthy();
    expect(screen.queryByTestId("cine024-access-revoked")).toBeNull();
  });
});
