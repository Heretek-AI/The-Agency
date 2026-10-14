/**
 * Envelope shape (shared context 9.7): headings, branch line, grants,
 * artifacts path, acceptance list, and the no-push closing.
 */
import { describe, expect, test } from "bun:test";
import { buildEnvelope } from "../src/envelope.js";

describe("envelope", () => {
  test("a scoped task names the branch and the grants", () => {
    const text = buildEnvelope({
      taskId: "docs-1",
      title: "Document",
      missionId: "m-1",
      role: "docs",
      expert: "docs",
      objective: "Write the guide.",
      acceptance: ["guide exists", "checks pass"],
      worktree: "/work/demo/trees/docs-1",
      branch: "fleet/docs-1",
      grantedPaths: ["README*", "docs/*"],
    });
    expect(text).toContain("# Task docs-1: Document");
    expect(text).toContain("Mission: m-1   Role: docs   Assigned to: docs");
    expect(text).toContain("## Objective");
    expect(text).toContain("Write the guide.");
    expect(text).toContain("Branch: fleet/docs-1.");
    expect(text).toContain("You may modify only: README*, docs/*.");
    expect(text).toContain("/artifacts/docs-1/");
    expect(text).toContain("1. guide exists");
    expect(text).toContain("2. checks pass");
    expect(text).toContain("Do not push, merge, or switch branches.");
  });

  test("a read-only task is detached with no grants", () => {
    const text = buildEnvelope({
      taskId: "scout-1",
      title: "Recon",
      missionId: "m-1",
      role: "recon",
      expert: "scout",
      objective: "Look around.",
      acceptance: [],
      worktree: "/work/demo/trees/scout-1",
      branch: null,
      grantedPaths: [],
    });
    expect(text).toContain("Branch: detached, read-only.");
    expect(text).toContain("nothing; write findings to the artifacts directory");
  });
});
