import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CineMatchContractStudio } from "@/components/cinematch/CineMatchContractStudio";
import { RoomCodeChip } from "@/components/cinematch/CineMatchPrimitives";

function mockClipboard(writeTextImpl?: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: writeTextImpl ? { writeText: vi.fn(writeTextImpl) } : undefined,
  });
}

describe("CINE-022 Interactive Clipboard & WAI-ARIA Tablist Contracts", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("RoomCodeChip reports success only when clipboard.writeText resolves, and renders alert without false success on rejection or unavailability", async () => {
    // 1. Success path
    const writeSuccess = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeSuccess);

    const { unmount } = render(
      <RoomCodeChip code="CNM482" invitePath="/cinematch?code=CNM482" />
    );

    fireEvent.click(screen.getByRole("button", { name: /Copy Code/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Code Copied/i })).toBeTruthy();
    });
    expect(writeSuccess).toHaveBeenCalledWith("CNM482");
    expect(screen.queryByTestId("cm-copy-error")).toBeNull();
    unmount();

    // 2. Rejection path (must NOT show Code Copied / Invite Copied)
    const writeReject = vi.fn().mockRejectedValue(new Error("Permission denied"));
    mockClipboard(writeReject);

    render(<RoomCodeChip code="CNM482" invitePath="/cinematch?code=CNM482" />);
    fireEvent.click(screen.getByRole("button", { name: /Copy Invite Link/i }));

    await waitFor(() => {
      expect(screen.getByTestId("cm-copy-error")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /Invite Copied/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Code Copied/i })).toBeNull();
    expect(screen.getByTestId("cm-copy-error").textContent).toContain(
      "Clipboard permission was denied."
    );
    expect(screen.getByTestId("cm-copy-error").textContent).toContain(
      "/cinematch?code=CNM482"
    );
    cleanup();

    // 3. Unavailable clipboard API path
    mockClipboard(undefined);
    render(<RoomCodeChip code="CNM482" invitePath="/cinematch?code=CNM482" />);
    fireEvent.click(screen.getByRole("button", { name: /Copy Code/i }));

    await waitFor(() => {
      expect(screen.getByTestId("cm-copy-error")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /Code Copied/i })).toBeNull();
    expect(screen.getByTestId("cm-copy-error").textContent).toContain(
      "Clipboard is unavailable in this browser."
    );
    expect(screen.getByTestId("cm-copy-error").textContent).toContain("CNM482");
  });

  it("Match Copy Match Title performs real clipboard copy and handles rejection without false success", async () => {
    const writeSuccess = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeSuccess);

    render(<CineMatchContractStudio />);
    fireEvent.click(screen.getByRole("tab", { name: /06 · Unanimous Match/i }));

    fireEvent.click(screen.getByRole("button", { name: /Copy Match Title/i }));
    await waitFor(() => {
      expect(screen.getByTestId("cm-match-share-success")).toBeTruthy();
    });
    expect(writeSuccess).toHaveBeenCalledWith("Movie Night Match: Inception (2010)");
    expect(
      screen.getByRole("button", { name: /Match Title Copied/i })
    ).toBeTruthy();

    // Switch clipboard to reject and click again
    const writeReject = vi.fn().mockRejectedValue(new Error("Denied"));
    mockClipboard(writeReject);

    fireEvent.click(screen.getByRole("button", { name: /Match Title Copied/i }));
    await waitFor(() => {
      expect(screen.getByTestId("cm-match-share-error")).toBeTruthy();
    });
    expect(screen.queryByTestId("cm-match-share-success")).toBeNull();
    expect(screen.queryByRole("button", { name: /Match Title Copied/i })).toBeNull();
    expect(screen.getByTestId("cm-match-share-error").textContent).toContain(
      "Movie Night Match: Inception (2010)"
    );
  });

  it("supports WAI-ARIA roving tabindex and ArrowLeft/ArrowRight/Home/End navigation across the 9-state tablist", () => {
    render(<CineMatchContractStudio />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(9);

    const createTab = screen.getByRole("tab", { name: /01 · Create Room/i });
    const joinTab = screen.getByRole("tab", { name: /02 · Join Room/i });
    const offlineTab = screen.getByRole("tab", {
      name: /09 · Offline \/ Reconnecting/i,
    });

    // Roving tabindex: only active tab has tabIndex=0
    expect(createTab.getAttribute("tabindex")).toBe("0");
    expect(joinTab.getAttribute("tabindex")).toBe("-1");
    expect(offlineTab.getAttribute("tabindex")).toBe("-1");

    createTab.focus();
    fireEvent.keyDown(createTab, { key: "ArrowRight" });
    expect(joinTab.getAttribute("aria-selected")).toBe("true");
    expect(joinTab.getAttribute("tabindex")).toBe("0");
    expect(createTab.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(joinTab);

    // ArrowLeft wraps back to Create then wraps to Offline
    fireEvent.keyDown(joinTab, { key: "ArrowLeft" });
    expect(createTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(createTab);

    fireEvent.keyDown(createTab, { key: "ArrowLeft" });
    expect(offlineTab.getAttribute("aria-selected")).toBe("true");
    expect(offlineTab.getAttribute("tabindex")).toBe("0");
    expect(document.activeElement).toBe(offlineTab);

    // Home jumps to first tab; End jumps to last tab
    fireEvent.keyDown(offlineTab, { key: "Home" });
    expect(createTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(createTab);

    fireEvent.keyDown(createTab, { key: "End" });
    expect(offlineTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(offlineTab);
  });
});
