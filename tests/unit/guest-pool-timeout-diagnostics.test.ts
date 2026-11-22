import { describe, expect, it } from "vitest";
import { describeUnexpectedFailure } from "@/lib/server/auth/guestResponse";

describe("describeUnexpectedFailure pool connection labels", () => {
  it("labels pg-pool connect timeouts without echoing the message", () => {
    const err = new Error("Connection terminated due to connection timeout", { cause: new Error("ETIMEDOUT host db.example") });
    const d = describeUnexpectedFailure(err);
    expect(d.invariant).toBe("pool_connection_timeout");
    expect(JSON.stringify(d)).not.toContain("db.example");
  });

  it("labels pool checkout timeouts", () => {
    expect(describeUnexpectedFailure(new Error("timeout exceeded when trying to connect")).invariant).toBe("pool_checkout_timeout");
  });
});
