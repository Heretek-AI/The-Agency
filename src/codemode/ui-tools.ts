import { DOM_GEOMETRY_AUDIT_SCRIPT } from "../geometry/audit-script.js"
import { STANDARD_VIEWPORTS } from "../geometry/viewports.js"

export function registerUITools(editor: any): void {
  editor.namespace({
    name: "ui",
    description: "Deterministic DOM geometry, contrast, alignment, and overflow audit tools for high-craft UI engineering.",
  })

  editor.add({
    name: "get_audit_script",
    description:
      "Returns the JavaScript expression string to pass to `tools.browser.evaluate({ tabID, script })` to mathematically audit the live page for horizontal overflow, sibling bounding-box collisions, WCAG contrast failures, descender clipping, and row baseline jitter.",
    options: { namespace: "ui", codemode: true, pinned: true },
    input: { type: "object", properties: {} },
    output: {
      type: "object",
      properties: {
        script: { type: "string" },
      },
      required: ["script"],
    },
    execute: async () => ({
      output: { script: DOM_GEOMETRY_AUDIT_SCRIPT },
      content: DOM_GEOMETRY_AUDIT_SCRIPT,
    }),
  })

  editor.add({
    name: "get_viewports",
    description: "Returns standard responsive viewport definitions (mobile 375px, tablet 768px, desktop 1440px, wide 1920px) for multi-device visual verification.",
    options: { namespace: "ui", codemode: true, pinned: true },
    input: { type: "object", properties: {} },
    output: {
      type: "object",
      properties: {
        viewports: { type: "object" },
      },
      required: ["viewports"],
    },
    execute: async () => ({
      output: { viewports: STANDARD_VIEWPORTS },
      content: JSON.stringify(STANDARD_VIEWPORTS, null, 2),
    }),
  })
}
