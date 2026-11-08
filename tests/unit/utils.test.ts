import { describe, it, expect } from "vitest";
import { cn, formatRuntime, getInitials, parseQuery } from "@/lib/utils";

describe("src/lib/utils unit tests", () => {
  describe("cn (tailwind merge + clsx)", () => {
    it("merges standard class names correctly", () => {
      expect(cn("px-2 py-1", "bg-red-500")).toBe("px-2 py-1 bg-red-500");
    });

    it("resolves conflicting tailwind classes cleanly", () => {
      expect(cn("px-2 px-4", "text-sm text-lg")).toBe("px-4 text-lg");
    });

    it("handles conditional class names", () => {
      const isHidden = false;
      const isHighlighted = true;
      expect(cn("base-class", isHidden && "hidden", isHighlighted && "ring-2")).toBe("base-class ring-2");
    });
  });

  describe("formatRuntime", () => {
    it("formats minutes and hours", () => {
      expect(formatRuntime(125)).toBe("2h 5min");
    });

    it("formats exact hours without minutes", () => {
      expect(formatRuntime(120)).toBe("2h");
    });

    it("returns N/A for invalid or zero runtime", () => {
      expect(formatRuntime(0)).toBe("N/A");
      expect(formatRuntime(-10)).toBe("N/A");
    });
  });

  describe("getInitials", () => {
    it("extracts uppercase initials from full names", () => {
      expect(getInitials("Christopher Nolan")).toBe("CN");
      expect(getInitials("Quentin Jerome Tarantino")).toBe("QJT");
    });

    it("handles single name strings", () => {
      expect(getInitials("Madonna")).toBe("M");
    });
  });

  describe("parseQuery", () => {
    it("parses query parameters with number and string types", () => {
      const parsed = parseQuery("vote_count_gte=100&sort_by=popularity.desc");
      expect(parsed.vote_count_gte).toBe(100);
      expect(parsed.sort_by).toBe("popularity.desc");
    });
  });
});
