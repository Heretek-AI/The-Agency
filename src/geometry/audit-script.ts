export interface DOMDefect {
  kind:
    | "page-horizontal-overflow"
    | "element-overflow-x"
    | "tiny-interactive-target"
    | "low-contrast"
    | "descender-clip-risk"
    | "sibling-collision"
    | "row-baseline-jitter"
    | string
  element: string
  detail: string
}

export interface DOMAuditResult {
  viewport: { width: number; height: number }
  defectCount: number
  passed: boolean
  defects: DOMDefect[]
}

/**
 * Deterministic DOM Geometry & Aesthetic Auditor Script.
 * Injected into Chromium via `tools.browser.evaluate({ tabID, script })`.
 */
export const DOM_GEOMETRY_AUDIT_SCRIPT = `(() => {
  const defects = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  function parseRgb(str) {
    if (!str || typeof str !== 'string') return null;
    const m = str.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
  }

  function blend(fg, bg) {
    const a = fg.a + bg.a * (1 - fg.a);
    if (a <= 0) return { r: 255, g: 255, b: 255, a: 1 };
    return {
      r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
      g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
      b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
      a
    };
  }

  function luminance({ r, g, b }) {
    const a = [r, g, b].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
  }

  function contrastRatio(c1, c2) {
    const l1 = luminance(c1);
    const l2 = luminance(c2);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  function effectiveBg(el) {
    const layers = [];
    let cur = el;
    while (cur && cur.nodeType === 1) {
      const bg = parseRgb(getComputedStyle(cur).backgroundColor);
      if (bg && bg.a > 0) {
        layers.push(bg);
        if (bg.a >= 0.99) break;
      }
      cur = cur.parentElement;
    }
    let composite = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) {
      composite = blend(layers[i], composite);
    }
    return composite;
  }

  function selector(el) {
    if (!el || !el.tagName) return 'unknown';
    const id = el.id ? '#' + el.id : '';
    const rawClass = typeof el.className === 'string'
      ? el.className
      : (el.className && typeof el.className.baseVal === 'string' ? el.className.baseVal : '');
    const cls = rawClass.trim()
      ? '.' + rawClass.trim().split(/\\s+/).slice(0, 2).join('.')
      : '';
    return el.tagName.toLowerCase() + id + cls;
  }

  // 1. Check horizontal page overflow
  if (document.documentElement.scrollWidth > vw + 2) {
    defects.push({
      kind: 'page-horizontal-overflow',
      element: 'html',
      detail: 'Document scrollWidth (' + document.documentElement.scrollWidth + 'px) exceeds viewport (' + vw + 'px)'
    });
  }

  const all = Array.from(document.querySelectorAll('body *'));
  for (const el of all) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || +style.opacity === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;

    // 2. Check unintentional horizontal text/element overflow
    if (
      el.scrollWidth > el.clientWidth + 2 &&
      style.overflowX !== 'auto' &&
      style.overflowX !== 'scroll' &&
      style.overflowX !== 'hidden'
    ) {
      defects.push({
        kind: 'element-overflow-x',
        element: selector(el),
        detail: 'scrollWidth=' + el.scrollWidth + ' > clientWidth=' + el.clientWidth
      });
    }

    // 3. Check interactive target size & dead clickables
    const isInteractive = el.matches('button, a, input, select, textarea, [role="button"]');
    if (isInteractive && (rect.width < 24 || rect.height < 24)) {
      defects.push({
        kind: 'tiny-interactive-target',
        element: selector(el),
        detail: Math.round(rect.width) + 'x' + Math.round(rect.height) + 'px (minimum 24x24px required)'
      });
    }

    // 4. Check text contrast & descender clipping on text-bearing nodes
    const hasDirectText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (hasDirectText) {
      const fg = parseRgb(style.color);
      const bg = effectiveBg(el);
      if (fg && bg) {
        const compFg = fg.a < 1 ? blend(fg, bg) : fg;
        const ratio = contrastRatio(compFg, bg);
        const fontSize = parseFloat(style.fontSize) || 14;
        const isBold = parseInt(style.fontWeight, 10) >= 700 || style.fontWeight === 'bold';
        const minRatio = fontSize >= 18.66 || (fontSize >= 14 && isBold) ? 3.0 : 4.5;
        if (ratio < minRatio) {
          defects.push({
            kind: 'low-contrast',
            element: selector(el),
            detail: 'Contrast ratio ' + ratio.toFixed(2) + ':1 < ' + minRatio + ':1 threshold (' + el.textContent.trim().slice(0, 30) + ')'
          });
        }
      }
      const lh = parseFloat(style.lineHeight);
      const fs = parseFloat(style.fontSize);
      if (lh && fs && lh / fs < 1.15 && style.overflow === 'hidden') {
        defects.push({
          kind: 'descender-clip-risk',
          element: selector(el),
          detail: 'line-height (' + lh + 'px) / font-size (' + fs + 'px) < 1.15 with overflow:hidden clips character descenders (g, y, p, q)'
        });
      }
    }

    // 5. Check sibling bounding-box collisions and row baseline misalignments
    const children = Array.from(el.children).filter((c) => {
      const cs = getComputedStyle(c);
      return (
        cs.display !== 'none' &&
        cs.visibility !== 'hidden' &&
        cs.position !== 'absolute' &&
        cs.position !== 'fixed' &&
        cs.position !== 'sticky'
      );
    });
    for (let i = 0; i < children.length; i++) {
      const r1 = children[i].getBoundingClientRect();
      for (let j = i + 1; j < children.length; j++) {
        const r2 = children[j].getBoundingClientRect();
        const overlapX = Math.max(0, Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left));
        const overlapY = Math.max(0, Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top));
        if (overlapX > 2 && overlapY > 2) {
          defects.push({
            kind: 'sibling-collision',
            element: selector(children[i]) + ' <-> ' + selector(children[j]),
            detail: 'Unintended overlap of ' + Math.round(overlapX) + 'x' + Math.round(overlapY) + 'px'
          });
        }
        const topDiff = Math.abs(r1.top - r2.top);
        if (topDiff > 0.5 && topDiff <= 3.5 && overlapX === 0) {
          defects.push({
            kind: 'row-baseline-jitter',
            element: selector(children[i]) + ' <-> ' + selector(children[j]),
            detail: 'Sibling row controls misaligned vertically by ' + topDiff.toFixed(1) + 'px'
          });
        }
      }
    }
  }

  return {
    viewport: { width: vw, height: vh },
    defectCount: defects.length,
    passed: defects.length === 0,
    defects: defects.slice(0, 50)
  };
})()`;
