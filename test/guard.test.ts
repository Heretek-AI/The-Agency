import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import {
  evaluatePermissionGuard,
  matchesPathPattern,
  registerPermissionGuard,
} from "../src/agents/guard.js"
import { createTask, initProject, lockContract } from "../src/board/board.js"

describe("SwarmOS v0.3.0 Runtime Permission & Ownership Guard", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "swarmos-guard-test-"))
    await initProject(tmpDir, {
      name: "Guard Test Project",
      vision: "Verify runtime contract and path ownership enforcement",
      aestheticArchetype: "High-Craft Technical Dark",
    })
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("matches exact paths, directory prefixes, and glob patterns accurately", () => {
    expect(matchesPathPattern("src/auth/types.ts", "src/auth/types.ts")).toBe(true)
    expect(matchesPathPattern("src/auth/types.ts", "src/auth")).toBe(true)
    expect(matchesPathPattern("src/auth/types.ts", "src/auth/**")).toBe(true)
    expect(matchesPathPattern("src/ui/components/Button.tsx", "src/ui/**/*.tsx")).toBe(true)
    expect(matchesPathPattern("src/server/db.ts", "src/ui/**")).toBe(false)
  })

  it("blocks non-architect roles from mutating locked architectural contract files", async () => {
    await lockContract(tmpDir, {
      id: "contract-core-schema",
      title: "Core Domain Schema",
      files: ["src/schema/domain.ts", "src/tokens/**"],
      invariants: ["Zero any types"],
      lockedBy: "architect",
    })

    // staff-backend attempting to edit locked contract -> DENIED
    const backendAttempt = await evaluatePermissionGuard(tmpDir, {
      agent: "staff-backend",
      action: "edit",
      resources: ["src/schema/domain.ts"],
      effect: "allow",
    })
    expect(backendAttempt.allowed).toBe(false)
    expect(backendAttempt.reason).toContain("SwarmOS Contract Guard")
    expect(backendAttempt.reason).toContain("contract-core-schema")

    // staff-ui attempting to edit locked token glob -> DENIED
    const uiAttempt = await evaluatePermissionGuard(tmpDir, {
      agent: "staff-ui",
      action: "edit",
      resources: ["src/tokens/colors.css"],
      effect: "allow",
    })
    expect(uiAttempt.allowed).toBe(false)

    // architect editing locked contract -> ALLOWED
    const architectAttempt = await evaluatePermissionGuard(tmpDir, {
      agent: "architect",
      action: "edit",
      resources: ["src/schema/domain.ts"],
      effect: "allow",
    })
    expect(architectAttempt.allowed).toBe(true)
  })

  it("enforces disjoint ownedPaths between staff-backend and staff-ui", async () => {
    await createTask(tmpDir, {
      id: "task-api",
      title: "Backend API routes",
      owner: "staff-backend",
      ownedPaths: ["src/server/**"],
    })
    await createTask(tmpDir, {
      id: "task-ui",
      title: "Frontend components",
      owner: "staff-ui",
      ownedPaths: ["src/components/**"],
    })

    // staff-backend editing its own path -> ALLOWED
    const backendValid = await evaluatePermissionGuard(tmpDir, {
      agent: "staff-backend",
      action: "edit",
      resources: ["src/server/routes.ts"],
      effect: "allow",
    })
    expect(backendValid.allowed).toBe(true)

    // staff-backend editing staff-ui's path -> DENIED
    const backendCrossLane = await evaluatePermissionGuard(tmpDir, {
      agent: "staff-backend",
      action: "edit",
      resources: ["src/components/Navbar.tsx"],
      effect: "allow",
    })
    expect(backendCrossLane.allowed).toBe(false)
    expect(backendCrossLane.reason).toContain("SwarmOS Ownership Guard")
    expect(backendCrossLane.reason).toContain("task-ui")

    // staff-ui editing staff-backend's path -> DENIED
    const uiCrossLane = await evaluatePermissionGuard(tmpDir, {
      agent: "staff-ui",
      action: "edit",
      resources: ["src/server/routes.ts"],
      effect: "allow",
    })
    expect(uiCrossLane.allowed).toBe(false)
    expect(uiCrossLane.reason).toContain("task-api")
  })

  it("blocks destructive git and source-mutating shell commands for director, manager, and qa-adversary", async () => {
    // Destructive git reset blocked for everyone
    const hardReset = await evaluatePermissionGuard(tmpDir, {
      agent: "staff-backend",
      action: "shell",
      resources: ["git reset --hard HEAD~1"],
      effect: "allow",
    })
    expect(hardReset.allowed).toBe(false)
    expect(hardReset.reason).toContain("SwarmOS Git Safety Guard")

    // Director running sed -i -> DENIED
    const directorMutate = await evaluatePermissionGuard(tmpDir, {
      agent: "director",
      action: "shell",
      resources: ["sed -i 's/foo/bar/g' src/index.ts"],
      effect: "allow",
    })
    expect(directorMutate.allowed).toBe(false)
    expect(directorMutate.reason).toContain("SwarmOS Separation-of-Powers Guard")

    // QA Adversary running bun test -> ALLOWED
    const qaTestRun = await evaluatePermissionGuard(tmpDir, {
      agent: "qa-adversary",
      action: "shell",
      resources: ["bun test test/"],
      effect: "allow",
    })
    expect(qaTestRun.allowed).toBe(true)

    // QA Adversary attempting to mutate src/ via shell redirect -> DENIED
    const qaRedirectSrc = await evaluatePermissionGuard(tmpDir, {
      agent: "qa-adversary",
      action: "shell",
      resources: ["echo 'export const hack = true' > src/index.ts"],
      effect: "allow",
    })
    expect(qaRedirectSrc.allowed).toBe(false)
    expect(qaRedirectSrc.reason).toContain("SwarmOS Red-Team Guard")
  })

  it("mutates permission.evaluate hook event in place to deny unauthorized actions", async () => {
    await lockContract(tmpDir, {
      id: "contract-1",
      title: "Types",
      files: ["src/types.ts"],
      invariants: ["Strict"],
    })

    let registeredHandler: any = null
    const mockCtx = {
      permission: {
        hook: async (name: string, fn: any) => {
          if (name === "evaluate") registeredHandler = fn
        },
      },
    }

    await registerPermissionGuard(mockCtx, tmpDir)
    expect(registeredHandler).toBeDefined()

    const event = {
      agent: "staff-ui",
      action: "edit",
      resources: ["src/types.ts"],
      effect: "allow" as const,
      message: undefined as string | undefined,
    }
    await registeredHandler(event)
    expect(event.effect).toBe("deny")
    expect(event.message).toContain("SwarmOS Contract Guard")
  })
})
