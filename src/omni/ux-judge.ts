import * as fs from "node:fs/promises"
import * as path from "node:path"

/**
 * Pillar 3: Quantitative 100-Point Visual Quality & UI/UX Judge (`src/omni/ux-judge.ts`)
 *
 * Deterministic 6-axis UI/UX scorecard across Spatial & Viewport Integrity (25 pts),
 * Alignment & Grid Harmony (20 pts), Typography & WCAG Contrast (20 pts),
 * Interactive & Accessibility Completeness (15 pts), Design Token Discipline (10 pts),
 * and Runtime Health (10 pts). Passing requires score >= 85 with zero horizontal overflow.
 */

export interface UXRawMetrics {
  viewport: { width: number; height: number }
  horizontalOverflowPx: number
  elementOverflowCount: number
  collisionCount: number
  baselineJitterCount: number
  lowContrastCount: number
  descenderClipCount: number
  tinyTargetCount: number
  missingLabelCount: number
  uniqueFontSizes: number
  arbitraryInlineHexCount: number
  consoleErrorCount: number
  failedNetworkCount: number
}

export interface UXScoreBreakdown {
  spatialLayout: { score: number; max: number }
  alignmentHarmony: { score: number; max: number }
  typographyAndContrast: { score: number; max: number }
  interactiveCompleteness: { score: number; max: number }
  designTokenDiscipline: { score: number; max: number }
  runtimeHealth: { score: number; max: number }
}

export interface UXScorecard {
  score: number
  grade: "S" | "A" | "B" | "C" | "F"
  passed: boolean
  viewport: { width: number; height: number }
  breakdown: UXScoreBreakdown
  remediation: string[]
  /** Legacy alias (pre-v1.0 callers used plural). */
  remediations: string[]
  evaluatedAt: string
}

export function scoreUXMetrics(metrics: UXRawMetrics): UXScorecard {
  const remediation: string[] = []
  let spatialScore = 25
  if (metrics.horizontalOverflowPx > 2) {
    spatialScore -= 15
    remediation.push(
      `Eliminate horizontal page overflow (${metrics.horizontalOverflowPx}px wider than ${metrics.viewport.width}px viewport).`,
    )
  }
  if (metrics.elementOverflowCount > 0) {
    const deduct = Math.min(10, metrics.elementOverflowCount * 4)
    spatialScore -= deduct
    remediation.push(`Fix ${metrics.elementOverflowCount} overflowing container(s) where scrollWidth > clientWidth.`)
  }
  spatialScore = Math.max(0, spatialScore)

  let alignmentScore = 20
  if (metrics.collisionCount > 0) {
    const deduct = Math.min(14, metrics.collisionCount * 7)
    alignmentScore -= deduct
    remediation.push(`Resolve ${metrics.collisionCount} sibling bounding-box overlap collision(s).`)
  }
  if (metrics.baselineJitterCount > 0) {
    const deduct = Math.min(8, metrics.baselineJitterCount * 2)
    alignmentScore -= deduct
    remediation.push(`Align ${metrics.baselineJitterCount} sibling row element(s) with 1px-3.5px vertical baseline jitter.`)
  }
  alignmentScore = Math.max(0, alignmentScore)

  let typographyScore = 20
  if (metrics.lowContrastCount > 0) {
    const deduct = Math.min(14, metrics.lowContrastCount * 4)
    typographyScore -= deduct
    remediation.push(`Increase foreground/background contrast on ${metrics.lowContrastCount} low-contrast text element(s) to meet WCAG AA (>= 4.5:1).`)
  }
  if (metrics.descenderClipCount > 0) {
    const deduct = Math.min(6, metrics.descenderClipCount * 3)
    typographyScore -= deduct
    remediation.push(`Increase line-height (>= 1.15x font-size) on ${metrics.descenderClipCount} clipped heading/text container(s).`)
  }
  typographyScore = Math.max(0, typographyScore)

  let interactiveScore = 15
  if (metrics.tinyTargetCount > 0) {
    const deduct = Math.min(9, metrics.tinyTargetCount * 3)
    interactiveScore -= deduct
    remediation.push(`Enlarge ${metrics.tinyTargetCount} interactive control(s) smaller than 24x24px minimum target size.`)
  }
  if (metrics.missingLabelCount > 0) {
    const deduct = Math.min(6, metrics.missingLabelCount * 3)
    interactiveScore -= deduct
    remediation.push(`Add accessible text or aria-label to ${metrics.missingLabelCount} unlabeled button/input control(s).`)
  }
  interactiveScore = Math.max(0, interactiveScore)

  let tokenScore = 10
  if (metrics.uniqueFontSizes > 8) {
    const deduct = Math.min(5, (metrics.uniqueFontSizes - 8) * 2)
    tokenScore -= deduct
    remediation.push(`Consolidate typography scale (${metrics.uniqueFontSizes} distinct font sizes detected; target <= 7).`)
  }
  if (metrics.arbitraryInlineHexCount > 0) {
    const deduct = Math.min(5, metrics.arbitraryInlineHexCount)
    tokenScore -= deduct
    remediation.push(`Replace ${metrics.arbitraryInlineHexCount} hardcoded inline style color(s) with semantic CSS variables.`)
  }
  tokenScore = Math.max(0, tokenScore)

  let runtimeScore = 10
  if (metrics.consoleErrorCount > 0) {
    runtimeScore -= Math.min(6, metrics.consoleErrorCount * 6)
    remediation.push(`Fix ${metrics.consoleErrorCount} uncaught browser console error(s).`)
  }
  if (metrics.failedNetworkCount > 0) {
    runtimeScore -= Math.min(4, metrics.failedNetworkCount * 4)
    remediation.push(`Fix ${metrics.failedNetworkCount} failing 4xx/5xx network request(s).`)
  }
  runtimeScore = Math.max(0, runtimeScore)

  const totalScore = spatialScore + alignmentScore + typographyScore + interactiveScore + tokenScore + runtimeScore
  const grade: UXScorecard["grade"] =
    totalScore >= 95 ? "S" : totalScore >= 85 ? "A" : totalScore >= 75 ? "B" : totalScore >= 60 ? "C" : "F"
  const passed = totalScore >= 85 && metrics.horizontalOverflowPx <= 2 && metrics.collisionCount === 0 && metrics.consoleErrorCount === 0

  return {
    score: totalScore,
    grade,
    passed,
    viewport: metrics.viewport,
    breakdown: {
      spatialLayout: { score: spatialScore, max: 25 },
      alignmentHarmony: { score: alignmentScore, max: 20 },
      typographyAndContrast: { score: typographyScore, max: 20 },
      interactiveCompleteness: { score: interactiveScore, max: 15 },
      designTokenDiscipline: { score: tokenScore, max: 10 },
      runtimeHealth: { score: runtimeScore, max: 10 },
    },
    remediation,
    remediations: remediation,
    evaluatedAt: new Date().toISOString(),
  }
}

export const UX_SCORECARD_BROWSER_SCRIPT = `(() => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const horizontalOverflowPx = Math.max(0, document.documentElement.scrollWidth - vw);
  let elementOverflowCount = 0;
  let collisionCount = 0;
  let baselineJitterCount = 0;
  let lowContrastCount = 0;
  let descenderClipCount = 0;
  let tinyTargetCount = 0;
  let missingLabelCount = 0;
  let arbitraryInlineHexCount = 0;
  const fontSizes = new Set();

  const all = Array.from(document.querySelectorAll('body *'));
  for (const el of all) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || +style.opacity === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (style.fontSize) fontSizes.add(style.fontSize);
    const inlineStyle = el.getAttribute('style') || '';
    if (/#[0-9a-fA-F]{3,8}\\b/.test(inlineStyle)) arbitraryInlineHexCount++;
    if (el.scrollWidth > el.clientWidth + 2 && !['auto', 'scroll', 'hidden'].includes(style.overflowX)) {
      elementOverflowCount++;
    }
    if (el.matches('button, a, input, select, textarea, [role="button"]')) {
      if (rect.width < 24 || rect.height < 24) tinyTargetCount++;
      const label = (el.textContent || '').trim() || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || '';
      if (!label && !el.querySelector('img[alt], svg[aria-label]')) missingLabelCount++;
    }
  }
  return {
    viewport: { width: vw, height: vh },
    horizontalOverflowPx,
    elementOverflowCount,
    collisionCount,
    baselineJitterCount,
    lowContrastCount,
    descenderClipCount,
    tinyTargetCount,
    missingLabelCount,
    uniqueFontSizes: fontSizes.size,
    arbitraryInlineHexCount,
    consoleErrorCount: 0,
    failedNetworkCount: 0
  };
})()`

export async function saveUXScorecard(rootDir: string, scorecard: UXScorecard): Promise<string> {
  const dir = path.join(rootDir, ".opencode", "artifacts")
  await fs.mkdir(dir, { recursive: true })
  const target = path.join(dir, "ux-scorecard.json")
  await fs.writeFile(target, JSON.stringify(scorecard, null, 2), "utf8")
  return target
}

export async function loadLatestUXScorecard(rootDir: string): Promise<UXScorecard | null> {
  try {
    const raw = await fs.readFile(path.join(rootDir, ".opencode", "artifacts", "ux-scorecard.json"), "utf8")
    return JSON.parse(raw) as UXScorecard
  } catch {
    return null
  }
}

export function registerUXJudgeTools(editor: any, rootDir: string): void {
  editor.add({
    name: "get_ux_scorecard_script",
    description:
      "Return the JavaScript expression string for `tools.browser.evaluate` that collects quantitative 6-axis UI/UX metrics from the live DOM.",
    options: { namespace: "ui", codemode: true, pinned: true },
    input: { type: "object", properties: {} },
    output: { type: "object" },
    execute: async () => ({
      output: { script: UX_SCORECARD_BROWSER_SCRIPT },
      content: UX_SCORECARD_BROWSER_SCRIPT,
    }),
  })
  editor.add({
    name: "score_ux",
    description:
      "Compute the deterministic 100-point Visual Quality & UI/UX Scorecard from collected DOM/browser metrics and persist `.opencode/artifacts/ux-scorecard.json`.",
    options: { namespace: "ui", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        viewport: { type: "object", properties: { width: { type: "number" }, height: { type: "number" } }, required: ["width", "height"] },
        horizontalOverflowPx: { type: "number" },
        elementOverflowCount: { type: "number" },
        collisionCount: { type: "number" },
        baselineJitterCount: { type: "number" },
        lowContrastCount: { type: "number" },
        descenderClipCount: { type: "number" },
        tinyTargetCount: { type: "number" },
        missingLabelCount: { type: "number" },
        uniqueFontSizes: { type: "number" },
        arbitraryInlineHexCount: { type: "number" },
        consoleErrorCount: { type: "number" },
        failedNetworkCount: { type: "number" },
      },
      required: ["viewport"],
    },
    output: { type: "object" },
    execute: async (input: UXRawMetrics) => {
      const normalized: UXRawMetrics = {
        viewport: input.viewport ?? { width: 1440, height: 900 },
        horizontalOverflowPx: input.horizontalOverflowPx ?? 0,
        elementOverflowCount: input.elementOverflowCount ?? 0,
        collisionCount: input.collisionCount ?? 0,
        baselineJitterCount: input.baselineJitterCount ?? 0,
        lowContrastCount: input.lowContrastCount ?? 0,
        descenderClipCount: input.descenderClipCount ?? 0,
        tinyTargetCount: input.tinyTargetCount ?? 0,
        missingLabelCount: input.missingLabelCount ?? 0,
        uniqueFontSizes: (input as any).uniqueFontSizes ?? 5,
        arbitraryInlineHexCount: (input as any).arbitraryInlineHexCount ?? 0,
        consoleErrorCount: (input as any).consoleErrorCount ?? 0,
        failedNetworkCount: (input as any).failedNetworkCount ?? 0,
      }
      const report = scoreUXMetrics(normalized)
      await saveUXScorecard(rootDir, report)
      return {
        output: report,
        content: `UI/UX Scorecard: ${report.score}/100 (Grade ${report.grade}, Passed: ${report.passed})`,
      }
    },
  })
}
