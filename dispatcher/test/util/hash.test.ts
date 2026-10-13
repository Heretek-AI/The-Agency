import { describe, expect, test } from "bun:test";
import {
  canonicalJson,
  chainHash,
  hashJson,
  sha256Hex,
  GENESIS_HASH,
} from "../../src/util/hash.js";

describe("hash", () => {
  test("sha256Hex matches the known empty-string digest", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  test("canonical JSON is key-order independent", () => {
    expect(canonicalJson({ b: 1, a: { y: 2, x: 1 } })).toBe(
      canonicalJson({ a: { x: 1, y: 2 }, b: 1 }),
    );
    expect(hashJson({ b: 1, a: 1 })).toBe(hashJson({ a: 1, b: 1 }));
  });

  test("canonical JSON omits undefined values", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  test("chainHash links prevHash to the entry", () => {
    expect(chainHash(GENESIS_HASH, { seq: 1 })).toBe(
      sha256Hex(`${GENESIS_HASH}:${canonicalJson({ seq: 1 })}`),
    );
    expect(GENESIS_HASH).toBe("0".repeat(64));
  });
});
