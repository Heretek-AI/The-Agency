const LINE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/

function unescapeDouble(s: string): string {
  return s.replace(/\\([nt"\\])/g, (_, c) => ({ n: "\n", t: "\t", '"': '"', "\\": "\\" })[c as "n"])
}

export function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith("#")) return
    const m = LINE_RE.exec(raw)
    if (!m) throw new SyntaxError(`Invalid .env entry on line ${i + 1}`)
    const [, key, rest] = m
    let value: string
    const dq = /^"((?:[^"\\]|\\.)*)"(?:\s+#.*)?$/.exec(rest)
    const sq = /^'([^']*)'(?:\s+#.*)?$/.exec(rest)
    if (dq) value = unescapeDouble(dq[1])
    else if (sq) value = sq[1]
    else if (/^["']/.test(rest)) throw new SyntaxError(`Unterminated quote on line ${i + 1}`)
    else value = rest.replace(/\s+#.*$/, "").trim()
    env[key] = value
  })
  return env
}
