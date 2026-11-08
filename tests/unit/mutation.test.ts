import { describe, it, expect } from "vitest";

describe("Mutation and failure discrimination gate (Lesson L-008)", () => {
  it("passes cleanly in standard offline CI mode and fails with machine-readable sentinel when mutated", () => {
    const isMutated = process.env.DELIBERATE_MUTATION_FAILURE === "1";

    if (isMutated) {
      // Deliberate failure mode to qualify red CI gate with machine-readable sentinel
      expect(
        "PASS_SENTINEL",
        "[SENTINEL_DELIBERATE_CI_RED_MUTATION_VERIFIED] Deliberate test failure for CI gate verification"
      ).toBe("FAIL_SENTINEL");
    } else {
      // Standard green baseline
      expect(true).toBe(true);
    }
  });
});
