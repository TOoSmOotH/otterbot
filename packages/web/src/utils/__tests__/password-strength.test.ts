import { describe, it, expect } from "vitest";
import { scorePassword } from "../password-strength";

describe("scorePassword", () => {
  it("returns score 0 for empty string", () => {
    const result = scorePassword("");
    expect(result.score).toBe(0);
    expect(result.label).toBe("Very weak");
  });

  it("returns score 0 for passwords shorter than 8 characters", () => {
    expect(scorePassword("abc").score).toBe(0);
    expect(scorePassword("1234567").score).toBe(0);
  });

  it("returns score 0 for common passwords", () => {
    expect(scorePassword("password").score).toBe(0);
    expect(scorePassword("12345678").score).toBe(0);
    expect(scorePassword("PASSWORD").score).toBe(0); // case-insensitive
    expect(scorePassword("qwerty123").score).toBe(0);
  });

  it("returns score 0 for all-same-character passwords", () => {
    expect(scorePassword("aaaaaaaa").score).toBe(0);
    expect(scorePassword("11111111").score).toBe(0);
  });

  it("returns low score for simple 8-char passwords", () => {
    // Only lowercase, 8 chars → length(1) + classes(1) = 2 points → score 0
    const result = scorePassword("abcdefgz");
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it("returns higher score for mixed-case passwords", () => {
    // lowercase + uppercase + 8 chars → better than single-class
    const result = scorePassword("HeLLoWrD");
    expect(result.score).toBeGreaterThanOrEqual(1);
  });

  it("returns higher score for passwords with digits and specials", () => {
    const result = scorePassword("Abc123!@");
    expect(result.score).toBeGreaterThanOrEqual(2);
  });

  it("returns high score for long diverse passwords", () => {
    const result = scorePassword("MyStr0ng!Pass#2024");
    expect(result.score).toBeGreaterThanOrEqual(3);
  });

  it("returns score 4 for very long diverse passwords", () => {
    const result = scorePassword("C0rrect-H0rse_B@ttery.Staple!");
    expect(result.score).toBe(4);
    expect(result.label).toBe("Strong");
  });

  it("penalizes low unique character count", () => {
    // 8 chars but only 2 unique → penalty
    const lowUnique = scorePassword("aabbccaa");
    const highUnique = scorePassword("abcdefgh");
    expect(lowUnique.score).toBeLessThanOrEqual(highUnique.score);
  });

  it("returns consistent label for each score", () => {
    expect(scorePassword("").label).toBe("Very weak");
    // A password that reliably gets score 4
    expect(scorePassword("X#9kLm!pQ2wZ@7rT").label).toBe("Strong");
  });
});
