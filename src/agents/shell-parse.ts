/**
 * A small POSIX-shell parser for permission decisions. It does not execute or expand anything;
 * it splits a command line into simple commands (following `;`, `&&`, `||`, `|`, `&`, newlines,
 * subshells, `$(...)`, backticks, process substitution, `bash -c`, `eval` and common wrappers),
 * records redirections, and classifies what each command can do.
 */

export type ShellEffect = "read" | "verify" | "write" | "network" | "destructive" | "exec"

export interface Redirect {
  op: string
  target: string
}

export interface SimpleCommand {
  argv: string[]
  redirects: Redirect[]
}

export interface CommandAnalysis {
  program: string
  argv: string[]
  effects: ShellEffect[]
  /** File paths this command may create, modify or delete (when knowable). */
  writes: string[]
  note?: string
}

export interface ShellAnalysis {
  commands: CommandAnalysis[]
  effects: ShellEffect[]
  writes: string[]
  /** True when parsing failed (unbalanced quotes etc.); callers should treat the command as unknown. */
  unparseable: boolean
}

interface ParseResult {
  commands: SimpleCommand[]
  nested: string[]
  ok: boolean
}

const OPERATOR_CHARS = new Set([";", "&", "|", "\n", "(", ")"])

/** Finds the index of the `)` closing a `$(` / `<(` opened just before `start`, honoring quotes. */
function findClosingParen(src: string, start: number): number {
  let depth = 1
  for (let i = start; i < src.length; i++) {
    const ch = src[i]
    if (ch === "\\") {
      i++
    } else if (ch === "'") {
      const end = src.indexOf("'", i + 1)
      if (end < 0) return -1
      i = end
    } else if (ch === '"') {
      i++
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\") i++
        i++
      }
      if (i >= src.length) return -1
    } else if (ch === "(") {
      depth++
    } else if (ch === ")") {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

export function parseShell(src: string): ParseResult {
  const commands: SimpleCommand[] = []
  const nested: string[] = []
  let argv: string[] = []
  let redirects: Redirect[] = []
  let word = ""
  let inWord = false
  let pendingRedirect: string | null = null
  const pendingHeredocs: string[] = []
  let ok = true

  const endWord = () => {
    if (!inWord) return
    if (pendingRedirect) {
      if (pendingRedirect.startsWith("<<") && !pendingRedirect.startsWith("<<<")) {
        pendingHeredocs.push(word)
      } else {
        redirects.push({ op: pendingRedirect, target: word })
      }
      pendingRedirect = null
    } else {
      argv.push(word)
    }
    word = ""
    inWord = false
  }
  const endCommand = () => {
    endWord()
    if (argv.length || redirects.length) commands.push({ argv, redirects })
    argv = []
    redirects = []
  }

  let i = 0
  while (i < src.length) {
    const ch = src[i]

    if (ch === "\\") {
      if (src[i + 1] === "\n") {
        i += 2
        continue
      }
      word += src[i + 1] ?? ""
      inWord = true
      i += 2
      continue
    }

    if (ch === "'") {
      const end = src.indexOf("'", i + 1)
      if (end < 0) {
        ok = false
        word += src.slice(i + 1)
        inWord = true
        break
      }
      word += src.slice(i + 1, end)
      inWord = true
      i = end + 1
      continue
    }

    if (ch === '"') {
      i++
      inWord = true
      let closed = false
      while (i < src.length) {
        const c = src[i]
        if (c === "\\" && i + 1 < src.length && '"\\$`\n'.includes(src[i + 1])) {
          word += src[i + 1]
          i += 2
        } else if (c === '"') {
          closed = true
          i++
          break
        } else if (c === "$" && src[i + 1] === "(" && src[i + 2] !== "(") {
          const end = findClosingParen(src, i + 2)
          if (end < 0) {
            ok = false
            i = src.length
            break
          }
          nested.push(src.slice(i + 2, end))
          word += "$(...)"
          i = end + 1
        } else if (c === "`") {
          const end = src.indexOf("`", i + 1)
          if (end < 0) {
            ok = false
            i = src.length
            break
          }
          nested.push(src.slice(i + 1, end))
          word += "`...`"
          i = end + 1
        } else {
          word += c
          i++
        }
      }
      if (!closed) ok = false
      continue
    }

    if (ch === "$" && src[i + 1] === "(" && src[i + 2] === "(") {
      // Arithmetic expansion: keep as an opaque word.
      const end = src.indexOf("))", i + 3)
      if (end < 0) {
        ok = false
        break
      }
      word += src.slice(i, end + 2)
      inWord = true
      i = end + 2
      continue
    }

    if ((ch === "$" || ch === "<" || ch === ">") && src[i + 1] === "(") {
      if (ch !== "$" && inWord) {
        // e.g. "a>(" is unusual; fall through to operator handling below.
      } else {
        const end = findClosingParen(src, i + 2)
        if (end < 0) {
          ok = false
          break
        }
        nested.push(src.slice(i + 2, end))
        word += ch === "$" ? "$(...)" : `${ch}(...)`
        inWord = true
        i = end + 1
        continue
      }
    }

    if (ch === "`") {
      const end = src.indexOf("`", i + 1)
      if (end < 0) {
        ok = false
        break
      }
      nested.push(src.slice(i + 1, end))
      word += "`...`"
      inWord = true
      i = end + 1
      continue
    }

    if (ch === "#" && !inWord) {
      const nl = src.indexOf("\n", i)
      i = nl < 0 ? src.length : nl
      continue
    }

    // Redirection operators, optionally prefixed by an fd number already collected in `word`.
    if (ch === ">" || ch === "<" || (ch === "&" && src[i + 1] === ">")) {
      let fdPrefix = ""
      if (inWord && /^\d+$/.test(word)) {
        fdPrefix = word
        word = ""
        inWord = false
      } else {
        endWord()
      }
      let op = ch
      let j = i + 1
      if (ch === "&") {
        op = "&>"
        j = i + 2
        if (src[j] === ">") {
          op = "&>>"
          j++
        }
      } else if (ch === ">" && (src[j] === ">" || src[j] === "|")) {
        op += src[j]
        j++
      } else if (ch === "<" && src[j] === "<") {
        op = "<<"
        j++
        if (src[j] === "<") {
          op = "<<<"
          j++
        } else if (src[j] === "-") {
          op = "<<-"
          j++
        }
      } else if (ch === "<" && src[j] === ">") {
        op = "<>"
        j++
      }
      // fd duplication: >&2, 2>&1, <&0
      if ((op === ">" || op === "<") && src[j] === "&") {
        let k = j + 1
        while (k < src.length && /[0-9-]/.test(src[k])) k++
        redirects.push({ op: `${fdPrefix}${op}&`, target: src.slice(j + 1, k) })
        i = k
        continue
      }
      pendingRedirect = `${fdPrefix}${op}`
      i = j
      continue
    }

    if (OPERATOR_CHARS.has(ch)) {
      endCommand()
      if (ch === "\n" && pendingHeredocs.length > 0) {
        // Skip heredoc bodies so their lines are not parsed as commands.
        let pos = i + 1
        while (pendingHeredocs.length > 0) {
          const delim = pendingHeredocs.shift()!
          let found = false
          while (pos < src.length) {
            const nl = src.indexOf("\n", pos)
            const line = src.slice(pos, nl < 0 ? src.length : nl)
            pos = nl < 0 ? src.length : nl + 1
            if (line.replace(/^\t+/, "") === delim) {
              found = true
              break
            }
          }
          if (!found) ok = false
        }
        i = pos
        continue
      }
      i++
      continue
    }

    if (ch === " " || ch === "\t" || ch === "\r") {
      endWord()
      i++
      continue
    }

    word += ch
    inWord = true
    i++
  }
  endCommand()
  if (pendingRedirect) ok = false

  return { commands, nested, ok }
}

const READ_ONLY = new Set([
  "ls", "cat", "head", "tail", "wc", "grep", "egrep", "fgrep", "rg", "ag", "pwd", "which", "whereis", "type",
  "echo", "printf", "stat", "file", "tree", "du", "df", "printenv", "cut", "tr", "diff", "cmp", "comm",
  "sha1sum", "sha256sum", "sha512sum", "md5sum", "shasum", "date", "uname", "whoami", "id", "true", "false",
  "test", "[", "basename", "dirname", "realpath", "readlink", "nl", "column", "jq", "less", "more", "hostname",
  "ps", "lsof", "xxd", "od", "hexdump", "strings", "fd", "fdfind", "sleep", "seq", "yes", "cd", "pushd", "popd",
  "uniq", "sort", "find", "sed", "awk", "gawk", "mawk", "ast-grep", "sg", "env", "tac", "rev", "fold", "expr",
  "locale", "getconf", "nproc", "free", "uptime", "ldd", "man", "help",
])

const WRITE_PROGRAMS = new Set([
  "rm", "rmdir", "mv", "cp", "touch", "mkdir", "ln", "chmod", "chown", "chgrp", "truncate", "dd", "tee",
  "install", "unzip", "tar", "patch", "shred", "unlink", "mkfifo", "split", "csplit", "gzip", "gunzip", "zip",
])

const NETWORK_PROGRAMS = new Set(["curl", "wget", "ssh", "scp", "sftp", "nc", "ncat", "netcat", "telnet", "ftp", "gh", "rsync"])

const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "fish"])
const INTERPRETERS = new Set(["python", "python3", "python2", "node", "bun", "deno", "ruby", "perl", "php", "osascript", "pwsh", "powershell"])
const INLINE_FLAGS = new Set(["-c", "-e", "--eval", "-p", "--print", "-E", "-r"])

const VERIFY_SCRIPT_RE = /^(?:test|tests|lint|typecheck|type-check|check|check-types|build|format:check|fmt:check|ci)(?::.*)?$/

/** Strips wrappers like `sudo`, `env X=1`, `timeout 5`, `nice -n 5`, `xargs -0` and leading assignments. */
function unwrap(argv: string[]): { argv: string[]; viaXargs: boolean } {
  let a = [...argv]
  let viaXargs = false
  for (let guard = 0; guard < 10 && a.length > 0; guard++) {
    while (a.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(a[0])) a.shift()
    const p = a[0]
    if (!p) break
    if (p === "sudo" || p === "doas") {
      a.shift()
      while (a.length && a[0].startsWith("-")) {
        const flag = a.shift()!
        if (/^-[ugCh]$/.test(flag)) a.shift()
      }
    } else if (p === "env") {
      a.shift()
      while (a.length && (a[0].startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(a[0]))) {
        const flag = a.shift()!
        if (flag === "-u" || flag === "-C" || flag === "-S") a.shift()
      }
      if (a.length === 0) return { argv: ["env"], viaXargs }
    } else if (p === "timeout") {
      a.shift()
      while (a.length && a[0].startsWith("-")) {
        const flag = a.shift()!
        if (flag === "-s" || flag === "-k" || flag === "--signal" || flag === "--kill-after") a.shift()
      }
      a.shift() // duration
    } else if (p === "nice" || p === "ionice") {
      a.shift()
      while (a.length && a[0].startsWith("-")) {
        const flag = a.shift()!
        if (/^-[ncp]$/.test(flag)) a.shift()
      }
    } else if (p === "nohup" || p === "command" || p === "exec" || p === "time" || p === "builtin" || p === "stdbuf" || p === "unbuffer") {
      a.shift()
      while (a.length && a[0].startsWith("-")) a.shift()
    } else if (p === "xargs") {
      viaXargs = true
      a.shift()
      while (a.length && a[0].startsWith("-")) {
        const flag = a.shift()!
        if (/^-[IdEsLnPa]$/.test(flag)) a.shift()
      }
      if (a.length === 0) return { argv: ["echo"], viaXargs }
    } else {
      break
    }
  }
  return { argv: a, viaXargs }
}

function nonFlagArgs(args: string[]): string[] {
  const out: string[] = []
  let endOfFlags = false
  for (const a of args) {
    if (!endOfFlags && a === "--") {
      endOfFlags = true
      continue
    }
    if (!endOfFlags && a.startsWith("-") && a !== "-") continue
    out.push(a)
  }
  return out
}

function hasFlag(args: string[], ...flags: string[]): boolean {
  return args.some((a) => flags.includes(a) || flags.some((f) => /^-[a-zA-Z]$/.test(f) && /^-[a-zA-Z]+$/.test(a) && a.includes(f[1])))
}

function classifyGit(args: string[]): { effects: ShellEffect[]; writes: string[]; note?: string } {
  // Skip global options like -C <dir>, -c k=v, --no-pager.
  let i = 0
  while (i < args.length && args[i].startsWith("-")) {
    if (args[i] === "-C" || args[i] === "-c") i++
    i++
  }
  const sub = args[i] ?? ""
  const rest = args.slice(i + 1)
  const read = { effects: ["read"] as ShellEffect[], writes: [] as string[] }
  const write = { effects: ["write"] as ShellEffect[], writes: [] as string[] }

  switch (sub) {
    case "":
    case "status":
    case "diff":
    case "log":
    case "show":
    case "blame":
    case "rev-parse":
    case "ls-files":
    case "ls-tree":
    case "grep":
    case "describe":
    case "shortlog":
    case "cat-file":
    case "rev-list":
    case "merge-base":
    case "name-rev":
    case "whatchanged":
    case "help":
    case "version":
    case "--version":
      return read
    case "reflog":
      return rest[0] === "expire" || rest[0] === "delete" ? { effects: ["destructive"], writes: [], note: "rewrites reflog" } : read
    case "config":
      return hasFlag(rest, "--get", "--get-all", "--list", "-l", "--get-regexp") || nonFlagArgs(rest).length <= 1 ? read : write
    case "remote":
      return rest.length === 0 || hasFlag(rest, "-v", "--verbose") || rest[0] === "show" || rest[0] === "get-url" ? read : write
    case "branch":
      if (hasFlag(rest, "-D") || (hasFlag(rest, "-d", "--delete") && hasFlag(rest, "-f", "--force"))) {
        return { effects: ["destructive"], writes: [], note: "force-deletes a branch" }
      }
      return nonFlagArgs(rest).length === 0 || hasFlag(rest, "--list", "-l", "--show-current", "-a", "-r", "-v", "-vv", "--contains", "--merged")
        ? read
        : write
    case "tag":
      return nonFlagArgs(rest).length === 0 || hasFlag(rest, "-l", "--list", "-n") ? read : write
    case "stash":
      if (rest[0] === "list" || rest[0] === "show") return read
      if (rest[0] === "drop" || rest[0] === "clear") return { effects: ["destructive"], writes: [], note: "discards stashed work" }
      return write
    case "worktree":
      if (rest[0] === "list") return read
      if (rest[0] === "remove" && hasFlag(rest, "-f", "--force")) return { effects: ["destructive"], writes: [], note: "force-removes a worktree" }
      return write
    case "reset":
      return hasFlag(rest, "--hard", "--merge", "--keep") ? { effects: ["destructive"], writes: [], note: "discards working-tree changes" } : write
    case "clean":
      return hasFlag(rest, "-f", "--force") ? { effects: ["destructive"], writes: [], note: "deletes untracked files" } : read
    case "checkout": {
      const dashdash = rest.indexOf("--")
      if (dashdash >= 0 || rest.includes(".") || hasFlag(rest, "-f", "--force")) {
        return { effects: ["destructive"], writes: [], note: "overwrites working-tree files" }
      }
      return write
    }
    case "restore":
      return hasFlag(rest, "--staged", "-S") && !hasFlag(rest, "--worktree", "-W")
        ? write
        : { effects: ["destructive"], writes: [], note: "overwrites working-tree files" }
    case "push":
      if (rest.some((a) => a === "--force" || a === "-f" || /^-[a-zA-Z]*f/.test(a) || a === "--mirror" || a === "--delete" || a.startsWith("+"))) {
        return { effects: ["destructive", "network"], writes: [], note: "force-push or remote deletion" }
      }
      return { effects: ["write", "network"], writes: [] }
    case "pull":
    case "fetch":
    case "clone":
    case "submodule":
    case "ls-remote":
      return { effects: sub === "ls-remote" ? ["network"] : ["write", "network"], writes: [] }
    case "gc":
    case "prune":
      return hasFlag(rest, "--prune=now", "--aggressive") || sub === "prune"
        ? { effects: ["destructive"], writes: [], note: "prunes objects" }
        : write
    case "rm":
    case "mv":
      return { effects: ["write"], writes: nonFlagArgs(rest) }
    default:
      // add, commit, merge, rebase, cherry-pick, am, apply, revert, switch, init, notes, bisect, ...
      return write
  }
}

function classifyPackageManager(program: string, args: string[]): { effects: ShellEffect[]; writes: string[] } {
  const sub = args[0] ?? ""
  if (program === "npx" || program === "bunx" || (program === "pnpm" && sub === "dlx") || (program === "yarn" && sub === "dlx")) {
    return { effects: ["exec", "network"], writes: [] }
  }
  if (sub === "test" || sub === "t") return { effects: ["verify"], writes: [] }
  if (sub === "run" || sub === "run-script") {
    return VERIFY_SCRIPT_RE.test(args[1] ?? "") ? { effects: ["verify"], writes: [] } : { effects: ["exec"], writes: [] }
  }
  if (program === "bun" && sub === "test") return { effects: ["verify"], writes: [] }
  if (["install", "i", "add", "remove", "rm", "uninstall", "update", "upgrade", "ci", "link"].includes(sub)) {
    return { effects: ["write", "network"], writes: [] }
  }
  if (sub === "publish" || sub === "deploy") return { effects: ["network", "write"], writes: [] }
  if (["ls", "list", "outdated", "why", "view", "info", "--version", "-v", "help"].includes(sub)) {
    return { effects: sub === "view" || sub === "info" || sub === "outdated" ? ["network"] : ["read"], writes: [] }
  }
  if (program === "bun" || program === "node" || program === "deno") return { effects: ["exec"], writes: [] }
  return { effects: ["exec"], writes: [] }
}

function classify(argv: string[], depth: number): { effects: ShellEffect[]; writes: string[]; note?: string; nested?: string } {
  const program = (argv[0] ?? "").split("/").pop() ?? ""
  const args = argv.slice(1)

  if (SHELLS.has(program)) {
    const cIdx = args.findIndex((a) => a === "-c" || (/^-[a-zA-Z]*c$/.test(a) && a.startsWith("-")))
    if (cIdx >= 0 && args[cIdx + 1] !== undefined) return { effects: [], writes: [], nested: args[cIdx + 1] }
    return { effects: ["exec"], writes: [], note: `runs a ${program} script` }
  }
  if (program === "eval") return { effects: [], writes: [], nested: args.join(" ") }
  if (program === "source" || program === ".") return { effects: ["exec"], writes: [], note: "sources a script" }

  if (program === "git") return classifyGit(args)

  if (["npm", "pnpm", "yarn", "npx", "bunx", "bun", "deno"].includes(program)) {
    if (program === "bun" && INLINE_FLAGS.has(args[0] ?? "")) return { effects: ["exec"], writes: [], note: "inline bun script" }
    return classifyPackageManager(program, args)
  }

  if (INTERPRETERS.has(program)) {
    if (args.some((a) => INLINE_FLAGS.has(a) || /^-[a-zA-Z]*[ce]$/.test(a))) {
      if (program === "perl" && args.some((a) => /^-[a-zA-Z]*i/.test(a))) {
        return { effects: ["write", "exec"], writes: nonFlagArgs(args).slice(1), note: "perl in-place edit" }
      }
      return { effects: ["exec"], writes: [], note: `inline ${program} code` }
    }
    if ((program === "python" || program === "python3") && args[0] === "-m") {
      const mod = args[1] ?? ""
      if (["pytest", "unittest", "mypy", "py_compile", "compileall", "doctest", "pyflakes", "pylint"].includes(mod)) {
        return { effects: ["verify"], writes: [] }
      }
      if (mod === "pip") return { effects: ["write", "network"], writes: [] }
      if (mod === "http.server" || mod === "json.tool") return { effects: ["read"], writes: [] }
      return { effects: ["exec"], writes: [] }
    }
    if (program === "node" && (args[0] === "--check" || args[0] === "-c")) return { effects: ["verify"], writes: [] }
    if (program === "node" && args[0] === "--test") return { effects: ["verify"], writes: [] }
    if (args.length === 0 || args[0] === "--version" || args[0] === "-V") return { effects: ["read"], writes: [] }
    return { effects: ["exec"], writes: [], note: `runs a ${program} script` }
  }

  if (["tsc", "vitest", "jest", "pytest", "mypy", "oxlint", "biome", "eslint", "ruff", "prettier", "tsgo", "pyright", "go", "cargo", "make", "gradle", "mvn"].includes(program)) {
    if (program === "eslint" && hasFlag(args, "--fix")) return { effects: ["write"], writes: [] }
    if (program === "ruff" && (args[0] === "format" || hasFlag(args, "--fix"))) return { effects: ["write"], writes: [] }
    if (program === "prettier") return hasFlag(args, "--write", "-w") ? { effects: ["write"], writes: [] } : { effects: ["verify"], writes: [] }
    if (program === "biome" && hasFlag(args, "--write", "--apply")) return { effects: ["write"], writes: [] }
    if (program === "go") {
      const sub = args[0] ?? ""
      if (["test", "vet", "build", "list", "version", "env", "doc"].includes(sub)) return { effects: ["verify"], writes: [] }
      if (sub === "fmt") return { effects: ["write"], writes: [] }
      return { effects: ["write", "network"], writes: [] }
    }
    if (program === "cargo") {
      const sub = args[0] ?? ""
      if (["test", "check", "clippy", "build", "doc", "tree", "metadata", "--version"].includes(sub)) return { effects: ["verify"], writes: [] }
      if (sub === "fmt") return hasFlag(args, "--check") ? { effects: ["verify"], writes: [] } : { effects: ["write"], writes: [] }
      return { effects: ["write", "network"], writes: [] }
    }
    if (program === "make" || program === "gradle" || program === "mvn") {
      return /^(test|check|lint|build|verify)$/.test(args[0] ?? "") ? { effects: ["verify"], writes: [] } : { effects: ["exec"], writes: [] }
    }
    return { effects: ["verify"], writes: [] }
  }

  if (NETWORK_PROGRAMS.has(program)) {
    const writes: string[] = []
    if (program === "curl") {
      const o = args.findIndex((a) => a === "-o" || a === "--output")
      if (o >= 0 && args[o + 1]) writes.push(args[o + 1])
      if (hasFlag(args, "-O", "--remote-name")) writes.push("<remote-name>")
    }
    if (program === "wget") {
      const o = args.findIndex((a) => a === "-O" || a === "--output-document")
      writes.push(o >= 0 && args[o + 1] ? args[o + 1] : "<remote-name>")
    }
    if (program === "rsync" || program === "scp") {
      const files = nonFlagArgs(args)
      const dest = files[files.length - 1]
      if (dest && !dest.includes(":")) writes.push(dest)
    }
    return { effects: writes.length ? ["network", "write"] : ["network"], writes }
  }

  if (WRITE_PROGRAMS.has(program)) {
    const files = nonFlagArgs(args)
    let writes = files
    if (program === "cp" || program === "install" || program === "ln") writes = files.slice(-1)
    if (program === "dd") writes = args.filter((a) => a.startsWith("of=")).map((a) => a.slice(3))
    if (program === "tar") {
      const f = args.findIndex((a) => a === "-f" || /^-?[a-zA-Z]*f$/.test(a))
      const extracting = args.some((a) => /^-?[a-zA-Z]*x/.test(a) || a === "--extract")
      writes = extracting ? ["<archive contents>"] : f >= 0 && args[f + 1] ? [args[f + 1]] : []
      if (!extracting && !args.some((a) => /^-?[a-zA-Z]*c/.test(a) || a === "--create")) return { effects: ["read"], writes: [] }
    }
    if (program === "unzip") writes = ["<archive contents>"]
    if (program === "patch") writes = ["<patched files>"]
    if (program === "rm" && hasFlag(args, "-r", "-R", "--recursive") && files.some((f) => f === "/" || f === "~" || f === "*" || f === "." || f === "..")) {
      return { effects: ["destructive"], writes: files, note: "recursive delete of a broad path" }
    }
    return { effects: ["write"], writes }
  }

  if (READ_ONLY.has(program)) {
    if (program === "sed" && args.some((a) => a === "--in-place" || a.startsWith("--in-place=") || /^-[a-zA-Z]*i/.test(a))) {
      const operands: string[] = []
      let scriptViaFlag = false
      for (let k = 0; k < args.length; k++) {
        const x = args[k]
        if (x === "-e" || x === "-f" || x === "--expression" || x === "--file") {
          scriptViaFlag = true
          k++
        } else if (x.startsWith("--expression=") || x.startsWith("--file=")) {
          scriptViaFlag = true
        } else if (!x.startsWith("-") && x !== "") {
          operands.push(x)
        }
      }
      return { effects: ["write"], writes: scriptViaFlag ? operands : operands.slice(1), note: "sed in-place edit" }
    }
    if (program === "sed" && args.some((a) => /(^|;|\s)w\s+\S|(^|;)e(\s|$)/.test(a))) {
      return { effects: ["write", "exec"], writes: [], note: "sed script writes files or runs commands" }
    }
    if ((program === "awk" || program === "gawk" || program === "mawk") && (args.some((a) => /\bsystem\s*\(|print[^;]*>|\|\s*"/.test(a)) || hasFlag(args, "-i"))) {
      return { effects: ["write", "exec"], writes: [], note: "awk program writes files or runs commands" }
    }
    if (program === "find" && args.some((a) => ["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprintf", "-fls", "-fprint0"].includes(a))) {
      return args.includes("-delete") ? { effects: ["write"], writes: ["<find matches>"] } : { effects: ["exec"], writes: [], note: "find -exec" }
    }
    if (program === "sort" && args.some((a) => a === "-o" || a.startsWith("--output"))) {
      const o = args.indexOf("-o")
      return { effects: ["write"], writes: o >= 0 && args[o + 1] ? [args[o + 1]] : [] }
    }
    if ((program === "ast-grep" || program === "sg") && hasFlag(args, "-U", "--update-all", "--interactive", "-i")) {
      return { effects: ["write"], writes: [] }
    }
    return { effects: ["read"], writes: [] }
  }

  if (depth > 0 && program === "") return { effects: ["read"], writes: [] }
  return { effects: ["exec"], writes: [], note: program ? `unknown program "${program}"` : undefined }
}

const SAFE_REDIRECT_TARGETS = new Set(["/dev/null", "/dev/stdout", "/dev/stderr", "/dev/tty"])

export function analyzeShell(src: string, depth = 0): ShellAnalysis {
  const parsed = parseShell(src)
  const commands: CommandAnalysis[] = []
  let unparseable = !parsed.ok

  for (const cmd of parsed.commands) {
    const { argv, viaXargs } = unwrap(cmd.argv)
    const result = argv.length ? classify(argv, depth) : { effects: ["read"] as ShellEffect[], writes: [] as string[] }
    const effects = new Set<ShellEffect>(result.effects)
    const writes = [...result.writes]

    if ("nested" in result && result.nested !== undefined) {
      if (depth >= 4) {
        effects.add("exec")
      } else {
        const inner = analyzeShell(result.nested, depth + 1)
        commands.push(...inner.commands)
        if (inner.unparseable) unparseable = true
      }
    }
    if (viaXargs && effects.has("write") && writes.length === 0) writes.push("<xargs input>")

    for (const r of cmd.redirects) {
      if (r.op.endsWith("&")) continue
      if (r.op.includes(">") && !SAFE_REDIRECT_TARGETS.has(r.target)) {
        effects.add("write")
        writes.push(r.target)
      }
    }
    if (effects.size === 0 && !("nested" in result && result.nested !== undefined)) effects.add("read")
    if (effects.size > 0) {
      commands.push({
        program: (argv[0] ?? "").split("/").pop() ?? "",
        argv,
        effects: [...effects],
        writes,
        ...("note" in result && result.note ? { note: result.note } : {}),
      })
    }
  }

  for (const n of parsed.nested) {
    if (depth >= 4) {
      unparseable = true
      continue
    }
    const inner = analyzeShell(n, depth + 1)
    commands.push(...inner.commands)
    if (inner.unparseable) unparseable = true
  }

  const effects = [...new Set(commands.flatMap((c) => c.effects))]
  return { commands, effects, writes: [...new Set(commands.flatMap((c) => c.writes))], unparseable }
}

export function isReadOnly(analysis: ShellAnalysis, allowVerify = false): boolean {
  if (analysis.unparseable || analysis.commands.length === 0) return false
  return analysis.effects.every((e) => e === "read" || (allowVerify && e === "verify"))
}
