import { describe, expect, it } from "vitest";
import { resolvePairOrigins, PairOriginsMisconfiguredError } from "./pair-origins";

// L3: the set of web-app origins allowed to `pair` is resolved fail-closed.
// Dev (COMMAND="serve") falls back to localhost; a production build
// (COMMAND="build") with no origins configured REFUSES rather than falling
// back — matching FIX 7's fail-closed boot. The escape hatch is an explicit,
// warned flag (ALLOW_ANY_PAIR_ORIGIN), never a silent default.

const LOCALHOST = ["http://localhost:3000", "http://localhost:5173"];

describe("resolvePairOrigins (L3 pair-origin allowlist)", () => {
  it("dev build with empty env allows localhost only", () => {
    const origins = resolvePairOrigins({ command: "serve", raw: undefined });
    expect(origins).toEqual(LOCALHOST);
  });

  it("dev build with empty string env still allows localhost only", () => {
    expect(resolvePairOrigins({ command: "serve", raw: "" })).toEqual(LOCALHOST);
  });

  it("production build with empty env FAILS rather than falling back to localhost", () => {
    expect(() => resolvePairOrigins({ command: "build", raw: undefined })).toThrow(
      PairOriginsMisconfiguredError,
    );
    expect(() => resolvePairOrigins({ command: "build", raw: "   " })).toThrow(
      PairOriginsMisconfiguredError,
    );
  });

  it("production build with origins set allows exactly those (normalized)", () => {
    const origins = resolvePairOrigins({
      command: "build",
      raw: "https://app.vellar.xyz, https://vellar.xyz",
    });
    expect(origins).toEqual(["https://app.vellar.xyz", "https://vellar.xyz"]);
  });

  it("normalizes and drops garbage entries in the configured list", () => {
    const origins = resolvePairOrigins({
      command: "build",
      // A single trailing slash is tolerated; a real path and a non-url are not.
      raw: "https://app.vellar.xyz/, not-a-url, https://vellar.xyz/path",
    });
    // "https://app.vellar.xyz/" -> "https://app.vellar.xyz"; the /path entry and
    // the non-url are rejected by normalizeOrigin.
    expect(origins).toEqual(["https://app.vellar.xyz"]);
  });

  it("a configured list of ONLY garbage in a prod build fails closed", () => {
    expect(() => resolvePairOrigins({ command: "build", raw: "not-a-url, file:///x" })).toThrow(
      PairOriginsMisconfiguredError,
    );
  });

  it("the explicit escape hatch opens pairing to any origin (empty allowlist = allow-any)", () => {
    // ALLOW_ANY_PAIR_ORIGIN is the named, warned override — returns the sentinel
    // that the router reads as "no origin restriction".
    expect(resolvePairOrigins({ command: "build", raw: undefined, allowAny: true })).toBe("any");
  });

  it("dedupes repeated origins", () => {
    expect(
      resolvePairOrigins({
        command: "build",
        raw: "https://app.vellar.xyz, https://app.vellar.xyz",
      }),
    ).toEqual(["https://app.vellar.xyz"]);
  });
});
