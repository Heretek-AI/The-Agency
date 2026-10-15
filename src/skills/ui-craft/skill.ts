import * as fs from "node:fs/promises"
import * as path from "node:path"

export const UI_CRAFT_SKILL_ID = "ui-craft"
export const UI_CRAFT_SKILL_NAME = "UI Craft & Spatial Architecture"

export const EMBEDDED_UI_CRAFT_SKILL_MD = `---
name: ui-craft
description: Anti-Slop Aesthetic Contract, Intentional Design Archetypes & Deterministic Spatial Engineering for High-Craft UIs
---

# SwarmOS UI Craft & Spatial Architecture Contract

You are bound by the **Anti-Slop Aesthetic Contract**. High-craft interfaces look intentional, disciplined, and bespoke—like Linear, Stripe, Raycast, and Apple. AI coding models regress to the statistical mean of training data unless strictly constrained.

---

## 1. Hard Anti-Slop Bans (Zero Tolerance)

1. **NO Neon Gradients**: Never use arbitrary purple-to-blue, indigo-to-pink, or cyan gradients unless explicitly specified in the project charter.
2. **NO Generic Icon-in-Circle Feature Grids**: Avoid circular pastel badge icons atop centered cards with 3-bullet lists.
3. **NO Arbitrary One-Off Spacing**: Every margin and padding value MUST adhere to an established geometric token scale (\`--space-1\` through \`--space-12\`). Never mix \`p-3\` and \`p-5\` on sibling cards.
4. **NO Line-Height Descender Clipping**: Never set \`line-height: 1\` on body or subtitle text combined with \`overflow: hidden\`. Descenders (\`g\`, \`y\`, \`p\`, \`q\`, \`j\`) will be clipped. Minimum line-height is \`1.4\` for body and \`1.15\` for large display headings.
5. **NO Blind JSX Authoring**: You must inspect your work in the attached Chromium browser using \`tools.ui.get_audit_script\` and \`tools.browser.screenshot\`.
6. **NO Placeholder Text**: Never write \`"Lorem ipsum"\` or \`"Feature description goes here"\`. Author realistic, domain-accurate copy.

---

## 2. Four Intentional Aesthetic Archetypes

Before authoring components, the project charter in \`tools.org\` records one chosen archetype:

### Archetype A: High-Craft Technical Dark (Linear / Raycast / Vercel)
- **Surfaces**: Layered dark slate / obsidian (\`--surface-0: #0D0E11\`, \`--surface-1: #16181D\`, \`--surface-2: #1F222A\`).
- **Borders**: 1px crisp hairline borders with subtle transparency (\`border: 1px solid rgba(255, 255, 255, 0.08)\`).
- **Elevation**: Subtle luminance stepping instead of heavy blur shadows.
- **Typography**: Tabular numerals (\`font-variant-numeric: tabular-nums\`), crisp 13px / 20px control density, tight tracking on headings (\`letter-spacing: -0.02em\`).
- **Focus Rings**: 2px high-contrast rings with 2px offset (\`ring-offset-2\`).

### Archetype B: Warm Editorial Studio Light (Stripe / Notion / Read.cv)
- **Surfaces**: Warm stone, alabaster, and paper (\`--surface-0: #FAF9F6\`, \`--surface-1: #FFFFFF\`, \`--surface-2: #F3F1EC\`).
- **Borders**: Soft warm hairlines (\`rgba(0, 0, 0, 0.06)\`).
- **Depth**: Delicate ambient occlusion shadows (\`box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 4px 12px rgba(0, 0, 0, 0.02)\`).
- **Typography**: Editorial serif or humanist sans, generous macro-whitespace, high contrast body ink (\`#1A1A1A\`).

### Archetype C: Swiss Grid / Data-Dense Workbench (Bloomberg / Grafana / IDE)
- **Surfaces**: Neutral gray chassis with zero wasted chrome.
- **Borders**: Exposed structural grid hairlines (\`1px solid var(--border-subtle)\`).
- **Layout**: Strict 4px/8px modular grid. Right-aligned numeric data columns with monospace numbers.
- **Status Badges**: Semantic pill badges with subdued tint backgrounds (\`rgba(emerald, 0.12)\` + solid text).

### Archetype D: Atmospheric Minimalist Product
- **Hero**: Typographic focal point with choreographed subtle entrance transitions.
- **Grid**: Asymmetrical bento layouts with proportional content weight.
- **Interactions**: Smooth cubic-bezier physics (\`cubic-bezier(0.22, 1, 0.36, 1)\`).

---

## 3. Core Design Token Scale

Every project must define root CSS tokens before building feature components:

\`\`\`css
:root {
  /* Spacing Scale (4px base) */
  --space-1: 0.25rem;  /* 4px */
  --space-2: 0.5rem;   /* 8px */
  --space-3: 0.75rem;  /* 12px */
  --space-4: 1rem;     /* 16px */
  --space-6: 1.5rem;   /* 24px */
  --space-8: 2rem;     /* 32px */
  --space-12: 3rem;    /* 48px */

  /* Radii */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 10px;
  --radius-full: 9999px;

  /* Typography */
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
\`\`\`

---

## 4. Complete Interactive States

Every button, input, tab, card, or menu item MUST implement seven distinct states:
1. \`default\`: Rest state with appropriate visual weight.
2. \`hover\`: Subdued brightness adjustment or hairline color shift (transition duration: 150ms).
3. \`focus-visible\`: High-contrast keyboard focus outline (never \`outline: none\` without replacement).
4. \`active\`: Subtle press depression (\`transform: scale(0.98)\` or deeper background).
5. \`disabled\`: Reduced opacity (0.45) with \`cursor: not-allowed\` and pointer events disabled.
6. \`loading\`: Inline spinner preserving control dimensions so layouts don't shift.
7. \`empty / error\`: Intentional state handling with actionable remediation copy.

---

## 5. Live DOM Geometry & Aesthetic Verification Loop

Before handing off any UI milestone:
1. Open the dev server in attached Chromium: \`execute\` -> \`tools.browser.tabs.open\`.
2. Retrieve the auditor script: \`execute\` -> \`tools.ui.get_audit_script\`.
3. Evaluate script across viewports: \`execute\` -> \`tools.browser.evaluate({ tabID, script })\`.
4. Capture visual screenshot: \`execute\` -> \`tools.browser.screenshot({ tabID })\`.
5. Fix every defect:
   - \`page-horizontal-overflow\`: Zero unwanted scroll on \`html\`/\`body\`.
   - \`element-overflow-x\`: Fix overflowing children or add explicit scroll boundaries.
   - \`sibling-collision\`: Eliminate overlapping bounding boxes.
   - \`low-contrast\`: Ensure contrast ratio \`>= 4.5:1\` (body) or \`>= 3.0:1\` (large text).
   - \`descender-clip-risk\`: Increase line-height or adjust padding.
   - \`row-baseline-jitter\`: Align sibling card and button top edges to exact pixels.`

export async function loadSkillContent(fallbackDir?: string): Promise<string> {
  const targetDir = fallbackDir ?? process.cwd()
  const candidate = path.resolve(targetDir, "src", "skills", "ui-craft", "SKILL.md")

  try {
    return await fs.readFile(candidate, "utf8")
  } catch {
    return EMBEDDED_UI_CRAFT_SKILL_MD
  }
}

export async function registerUICraftSkill(ctx: any, rootDir: string): Promise<void> {
  if (!ctx.skill?.transform) return

  const content = await loadSkillContent(rootDir)
  const absoluteSkillPath = path.resolve(rootDir, ".opencode", "skills", "ui-craft", "SKILL.md")

  await ctx.skill.transform((editor: any) => {
    editor.add({
      id: UI_CRAFT_SKILL_ID,
      name: UI_CRAFT_SKILL_NAME,
      description:
        "Anti-Slop Aesthetic Contract, Intentional Design Archetypes & Deterministic Spatial Engineering for High-Craft UIs",
      autoinvoke: true,
      path: absoluteSkillPath,
      content,
    })
  })
}
