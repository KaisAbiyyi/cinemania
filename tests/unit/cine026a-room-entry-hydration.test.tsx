import React from "react";
import { renderToString } from "react-dom/server";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/cinematch/CineMatchPrimitives", () => ({
  CineMatchAlertCard: ({ code }: { code: string }) => <p data-testid="cm-scoped-alert">{code}</p>,
}));

import { RoomEntry } from "@/components/cinematch/room/RoomEntry";

/**
 * CINE-026-A: before React commits hydration the controlled name field has no handler. A typed name was reset
 * to the empty state (client-side INVALID_DISPLAY_NAME with no request), and a click fell through to a native
 * GET submission that put the name and room code in the URL. The form must therefore be locked in the
 * server-rendered markup and unlock only after the client commit.
 */
describe("RoomEntry hydration gate", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); router.push.mockReset(); });

  it("server markup locks every control and marks the form not hydrated", () => {
    const html = renderToString(<RoomEntry initialCode="ABC234" />);
    expect(html).toContain('data-hydrated="false"');
    expect(html).toMatch(/<input[^>]*id="cm-display-name"[^>]*disabled=""/);
    expect(html).toMatch(/<input[^>]*id="cm-join-code"[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });

  it("unlocks after the client commit and sends the typed name to the server", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "ROOM_FULL", message: "full" }), { status: 409, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<RoomEntry initialCode="ABC234" />);
    await waitFor(() => expect(screen.getByTestId("cm-room-form").getAttribute("data-hydrated")).toBe("true"));
    const name = screen.getByLabelText("Your display name") as HTMLInputElement;
    expect(name.disabled).toBe(false);
    fireEvent.change(name, { target: { value: "Late Typist" } });
    fireEvent.click(screen.getByTestId("cm-room-submit"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/rooms/join");
    expect(JSON.parse(String(init.body))).toMatchObject({ displayName: "Late Typist", code: "ABC234" });
    vi.unstubAllGlobals();
  });
});
