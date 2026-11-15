import { describe, expect, it } from "vitest";
import { canon, canonNumber, checksumOf, fnv1a32 } from "../src/core/canon.js";

describe("canonical JSON", () => {
  it("prints numbers the same way Godot does after a float round trip", () => {
    expect(canonNumber(0)).toBe("0");
    expect(canonNumber(-0)).toBe("0");
    expect(canonNumber(42)).toBe("42");
    expect(canonNumber(42.0)).toBe("42");
    expect(canonNumber(0.8)).toBe("0.8");
    expect(canonNumber(212.5)).toBe("212.5");
    expect(canonNumber(1 / 3)).toBe("0.333333");
    expect(canonNumber(-1.25)).toBe("-1.25");
    expect(canonNumber(0.1 + 0.2)).toBe("0.3");
    expect(canonNumber(Number.NaN)).toBe("null");
  });

  it("sorts keys by code point and escapes like JSON.stringify", () => {
    expect(canon({ b: 1, a: [true, null, "x"], Z: {} })).toBe('{"Z":{},"a":[true,null,"x"],"b":1}');
    expect(canon({ "ข": 1, "a": 2 })).toBe('{"a":2,"ข":1}');
    expect(canon('say "hi"\n\t\\ ต้น')).toBe(JSON.stringify('say "hi"\n\t\\ ต้น'));
    expect(canon("\u0001")).toBe(JSON.stringify("\u0001"));
  });

  it("FNV-1a 32 over UTF-8", () => {
    expect(fnv1a32("")).toBe("811c9dc5");
    expect(fnv1a32("a")).toBe("e40c292c");
    expect(fnv1a32("foobar")).toBe("bf9cf968");
    expect(fnv1a32("ต้น")).not.toBe(fnv1a32("ตน"));
    expect(checksumOf({ b: 2, a: 1 })).toBe(checksumOf({ a: 1, b: 2.0 }));
  });
});
