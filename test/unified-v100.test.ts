import { describe, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import {
  cacheEpistemicSource,
  verifyEpistemicClaims,
  classifySpdxLicense,
  generateGrillQuestions,
  discoverClaudeCodeAssets,
  scoreUXMetrics,
  detectDomainPacks,
  inspectGodotScene,
  inspectGDevelopProject,
  inspectBinaryTarget,
  generateSwarmDashboardHtml,
} from "../src/index.js"

describe("SwarmOS v1.0.0 Unified Heretek Platform", () => {
  test("Pillar 1: IUMBTEMS Epistemic Cache, Verbatim Quote Verification & SPDX License Check", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "swarmos-epistemic-"))
    const cached = await cacheEpistemicSource(tmp, {
      title: "Effect 4.0 Architecture Spec",
      url: "https://effect.website/docs/v4",
      spdxLicense: "MIT",
      content: "Effect 4.0 introduces LayerMap for location-scoped service lifecycles and zero-leak fiber supervision.",
    })
    expect(cached.shortHash).toHaveLength(12)
    expect(cached.licenseCategory).toBe("permissive")

    const goodMd = `According to the spec, it works [VERIFIED: ${cached.shortHash} | "LayerMap for location-scoped service lifecycles"].`
    const auditPass = await verifyEpistemicClaims(tmp, goodMd)
    expect(auditPass.passed).toBe(true)
    expect(auditPass.verifiedCount).toBe(1)

    const badMd = `Hallucinated claim [VERIFIED: ${cached.shortHash} | "non-existent quote string"].`
    const auditFail = await verifyEpistemicClaims(tmp, badMd)
    expect(auditFail.passed).toBe(false)
    expect(auditFail.failedClaims).toHaveLength(1)

    expect(classifySpdxLicense("GPL-3.0-only")).toBe("copyleft-contaminating")
    expect(generateGrillQuestions("Distributed SQLite Swarm").questions.length).toBeGreaterThanOrEqual(5)
  })

  test("Pillar 2: claude-4-opencode Bridge discovers .claude commands, agents, and skills", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "swarmos-claude-"))
    await fs.mkdir(path.join(tmp, ".claude", "commands"), { recursive: true })
    await fs.mkdir(path.join(tmp, ".claude", "agents"), { recursive: true })
    await fs.mkdir(path.join(tmp, ".claude", "skills", "clean-arch"), { recursive: true })

    await fs.writeFile(
      path.join(tmp, ".claude", "commands", "audit-sec.md"),
      "---\ndescription: Security audit command\n---\nRun security audit on $ARGUMENTS",
    )
    await fs.writeFile(
      path.join(tmp, ".claude", "agents", "sec-reviewer.md"),
      "---\nname: Security Reviewer\ndescription: Audits auth flows\n---\nYou are a security reviewer.",
    )
    await fs.writeFile(
      path.join(tmp, ".claude", "skills", "clean-arch", "SKILL.md"),
      "---\nname: Clean Architecture\ndescription: Enforces hexagonal boundaries\n---\nKeep domain pure.",
    )

    const assets = await discoverClaudeCodeAssets(tmp)
    expect(assets.commands).toHaveLength(1)
    expect(assets.commands[0].name).toBe("audit-sec")
    expect(assets.agents).toHaveLength(1)
    expect(assets.skills).toHaveLength(1)
  })

  test("Pillar 3: Quantitative 100-Point Visual Quality & UI/UX Judge", () => {
    const cleanScore = scoreUXMetrics({
      viewport: { width: 1440, height: 900 },
      horizontalOverflowPx: 0,
      elementOverflowCount: 0,
      collisionCount: 0,
      baselineJitterCount: 0,
      lowContrastCount: 0,
      descenderClipCount: 0,
      tinyTargetCount: 0,
      missingLabelCount: 0,
      uniqueFontSizes: 5,
      arbitraryInlineHexCount: 0,
      consoleErrorCount: 0,
      failedNetworkCount: 0,
    })
    expect(cleanScore.score).toBe(100)
    expect(cleanScore.grade).toBe("S")
    expect(cleanScore.passed).toBe(true)

    const sloppyScore = scoreUXMetrics({
      viewport: { width: 375, height: 812 },
      horizontalOverflowPx: 42,
      elementOverflowCount: 2,
      collisionCount: 2,
      baselineJitterCount: 3,
      lowContrastCount: 3,
      descenderClipCount: 1,
      tinyTargetCount: 2,
      missingLabelCount: 1,
      uniqueFontSizes: 11,
      arbitraryInlineHexCount: 6,
      consoleErrorCount: 1,
      failedNetworkCount: 0,
    })
    expect(sloppyScore.passed).toBe(false)
    expect(sloppyScore.remediation.length).toBeGreaterThan(3)
  })

  test("Pillar 4: On-Demand Domain Packs (Godot 4, GDevelop 5, Reverse Engineering)", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "swarmos-packs-"))
    await fs.writeFile(path.join(tmp, "project.godot"), "[application]\nconfig/name=\"TestGame\"\n")
    await fs.writeFile(
      path.join(tmp, "Player.tscn"),
      '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://Player.gd" id="1"]\n[node name="Player" type="CharacterBody2D"]\n[node name="Sprite2D" type="Sprite2D" parent="."]\n[connection signal="hit" from="." to="." method="_on_hit"]\n',
    )
    await fs.writeFile(
      path.join(tmp, "game.json"),
      JSON.stringify({
        properties: { name: "SpaceJump", version: "1.0.0" },
        layouts: [{ name: "MainScene", objects: [{ name: "Hero" }], layers: [{ name: "Base" }], events: [{}, {}] }],
        externalEvents: [],
        eventsFunctionsExtensions: [{ name: "DoubleJump" }],
      }),
    )
    await fs.writeFile(path.join(tmp, "sample.bin"), Buffer.from("\x7fELF...http://api.internal.local/v1/secret_token_check..."))

    const detected = await detectDomainPacks(tmp)
    expect(detected.godot).toBe(true)
    expect(detected.gdevelop).toBe(true)
    expect(detected.reverseEngineering).toBe(true)

    const scene = await inspectGodotScene(tmp, "Player.tscn")
    expect(scene.nodeCount).toBe(2)
    expect(scene.signalConnections).toHaveLength(1)

    const gd = await inspectGDevelopProject(tmp, "game.json")
    expect(gd.projectName).toBe("SpaceJump")
    expect(gd.scenes[0].eventCount).toBe(2)

    const bin = await inspectBinaryTarget(tmp, "sample.bin")
    expect(bin.format).toBe("ELF")
    expect(bin.suspiciousStrings.length).toBeGreaterThan(0)
  })

  test("Pillar 5: The Agency Live Swarm Command Center HTML5 Dashboard", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "swarmos-dash-"))
    const dash = await generateSwarmDashboardHtml(tmp)
    expect(dash.dashboardPath).toContain("swarm-dashboard.html")
    const html = await fs.readFile(dash.dashboardPath, "utf8")
    expect(html).toContain("SwarmOS v1.0 — The Agency Command Center")
    expect(html).toContain("100-Point UI/UX Scorecard Breakdown")
  })
})
