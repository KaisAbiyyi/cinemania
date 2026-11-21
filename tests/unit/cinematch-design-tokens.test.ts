import { describe, expect, it } from "vitest";
import {
  CINEMATCH_SCREEN_CONTRACTS,
  buildContractPreviewFixture,
  computeWcagContrastRatio,
  getThemeContrastPairs,
  type CineMatchScreenStateId,
} from "@/components/cinematch/designTokens";

const REQUIRED_STATE_IDS: CineMatchScreenStateId[] = [
  "create",
  "join",
  "lobby",
  "swipe",
  "vote-wait",
  "match",
  "no-match",
  "error",
  "offline",
];

describe("CINE-022 CineMatch Design Tokens & Screen Contract", () => {
  it("defines all 9 required screen state contracts with backend mappings and accessibility rules", () => {
    const ids = CINEMATCH_SCREEN_CONTRACTS.map((c) => c.id);
    expect(ids).toEqual(REQUIRED_STATE_IDS);

    for (const contract of CINEMATCH_SCREEN_CONTRACTS) {
      expect(contract.backendMapping.endpointOrAction.length).toBeGreaterThan(5);
      expect(contract.requiredElements.length).toBeGreaterThanOrEqual(3);
      expect(contract.keyboardContract.length).toBeGreaterThanOrEqual(1);
      expect(contract.prohibitedPatterns.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("passes WCAG 2.1 AA contrast ratios for every Light and Dark theme token pair", () => {
    for (const mode of ["light", "dark"] as const) {
      const pairs = getThemeContrastPairs(mode);
      expect(pairs.length).toBeGreaterThanOrEqual(10);

      for (const pair of pairs) {
        const ratio = computeWcagContrastRatio(
          pair.foregroundHex,
          pair.backgroundHex
        );
        expect(
          ratio,
          `${pair.id} (${pair.label}) contrast ${ratio}:1 must be >= ${pair.minRatio}:1`
        ).toBeGreaterThanOrEqual(pair.minRatio);
      }
    }
  });

  it("builds valid, secret-free SafeRoomSnapshot fixtures across all 9 states and 3 no-match variants", () => {
    for (const stateId of REQUIRED_STATE_IDS) {
      const fixture = buildContractPreviewFixture(stateId);
      expect(fixture.snapshot.code).toBe("CNM482");
      expect(fixture.snapshot.deckFilter.include_adult).toBe(false);
      // Verify peer participants never leak internal participantId
      for (const participant of fixture.snapshot.participants) {
        expect("participantId" in participant).toBe(false);
      }
    }

    const exhausted = buildContractPreviewFixture("no-match", "DECK_EXHAUSTED");
    expect(exhausted.snapshot.finishState.code).toBe("DECK_EXHAUSTED");
    expect(exhausted.snapshot.finishState.retryAvailable).toBe(true);

    const cancelled = buildContractPreviewFixture("no-match", "ROUND_CANCELLED");
    expect(cancelled.snapshot.finishState.code).toBe("ROUND_CANCELLED");
    expect(cancelled.snapshot.status).toBe("LOBBY");

    const expired = buildContractPreviewFixture("no-match", "ROOM_EXPIRED");
    expect(expired.snapshot.finishState.code).toBe("ROOM_EXPIRED");
    expect(expired.snapshot.finishState.recoverable).toBe(false);
  });
});
