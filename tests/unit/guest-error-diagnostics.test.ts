import { describe, expect, it } from "vitest";
import { describeUnexpectedFailure } from "@/lib/server/auth/guestResponse";

describe("describeUnexpectedFailure (sanitized 500 diagnostics)", () => {
  it("reports an allowlisted SQLSTATE from the error itself", () => {
    const err = Object.assign(new Error("deadlock detected on room 9f3c"), { code: "40P01", severity: "ERROR" });
    const d = describeUnexpectedFailure(err);
    expect(d.sqlstate).toBe("40P01");
    expect(d.category).toBe("postgres");
  });

  it("walks the cause chain so a wrapped lock timeout is still visible", () => {
    const pg = Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03", severity: "ERROR" });
    const wrapped = new Error("transaction failed", { cause: pg });
    const d = describeUnexpectedFailure(wrapped);
    expect(d.sqlstate).toBe("55P03");
    expect(d.causeDepth).toBe(1);
  });

  it("maps unlisted SQLSTATEs to a fixed token and never echoes the raw code", () => {
    const d = describeUnexpectedFailure(Object.assign(new Error("x"), { code: "ZZ999" }));
    expect(d.sqlstate).toBe("OTHER_SQLSTATE");
    expect(JSON.stringify(d)).not.toContain("ZZ999");
  });

  it("emits fixed labels for known invariant messages without echoing the message", () => {
    const err = new Error("Duplicate vote encountered for participant 5dd93cf9-7848-46fb-8075-16fef14102c2 on candidate 1");
    const d = describeUnexpectedFailure(err);
    expect(d.invariant).toBe("duplicate_vote_in_consensus");
    expect(JSON.stringify(d)).not.toContain("5dd93cf9");
    expect(JSON.stringify(d)).not.toContain("Duplicate vote");
  });

  it("never exposes message text, SQL or identifiers in any field", () => {
    const err = new TypeError("select * from rooms where id = 'secret-room-id' token=eyJhbGciOi");
    const json = JSON.stringify(describeUnexpectedFailure(err));
    expect(json).not.toContain("secret-room-id");
    expect(json).not.toContain("eyJhbGciOi");
    expect(json).not.toContain("select");
    expect(json).toContain("TypeError");
  });

  it("gives every failure a fresh correlation ID", () => {
    const a = describeUnexpectedFailure(new Error("a")).correlationId;
    const b = describeUnexpectedFailure(new Error("a")).correlationId;
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
  });
});
