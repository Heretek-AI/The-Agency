import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { analyzeBlastRadius, buildRepoGraph, buildRepoMap, parseSourceFacts } from "../src/omni/repomap.js"

async function writeTree(root: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true })
    await fs.writeFile(path.join(root, rel), content)
  }
}

describe("SwarmOS v0.8.0 multi-language RepoMap", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "swarmos-repomap-test-"))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("ignores imports inside comments and strings", () => {
    const facts = parseSourceFacts(
      [
        '// import { fake } from "./commented"',
        '/* import x from "./block" */',
        'const s = "import y from \'./in-string\'"',
        'import { real, other as alias } from "./real.js"',
        'export { real } from "./real.js"',
        "export function shown() {}",
      ].join("\n"),
      "ts",
    )
    expect(facts.imports.map((i) => i.spec)).toEqual(["./real.js", "./real.js"])
    expect(facts.imports[0].names).toEqual(["real", "other"])
    expect(facts.exports.sort()).toEqual(["real", "shown"])
  })

  it("tracks symbols through TypeScript re-exports", async () => {
    await writeTree(tmpDir, {
      "src/math.ts": "export function add() {}\nexport function sub() {}\n",
      "src/index.ts": 'export { add as plus, sub } from "./math.js"\n',
      "src/a.ts": 'import { plus } from "./index.js"\nexport const a = plus\n',
      "src/b.ts": 'import { sub } from "./index.js"\nexport const b = sub\n',
      "src/c.ts": 'import { a } from "./a.js"\nexport const c = a\n',
      "src/star.ts": 'import * as all from "./math.js"\nexport const s = all\n',
    })
    const add = await analyzeBlastRadius(tmpDir, "src/math.ts", "add")
    expect(add.directDependents).toEqual(["src/a.ts", "src/star.ts"])
    expect(add.transitiveDependents).toEqual(["src/a.ts", "src/c.ts", "src/star.ts"])
    const sub = await analyzeBlastRadius(tmpDir, "src/math.ts", "sub")
    expect(sub.directDependents).toEqual(["src/b.ts", "src/star.ts"])
    const whole = await analyzeBlastRadius(tmpDir, "src/math.ts")
    expect(whole.directDependents).toEqual(["src/index.ts", "src/star.ts"])
  })

  it("resolves Python absolute, relative and submodule imports", async () => {
    await writeTree(tmpDir, {
      "pkg/__init__.py": "",
      "pkg/core.py": "def compute():\n    pass\n\nclass Engine:\n    pass\n",
      "pkg/api.py": "from .core import compute\n# from .ghost import nothing\n",
      "app.py": 'from pkg import core\nimport pkg.api\n"""\nimport fake\n"""\n',
    })
    const graph = await buildRepoGraph(tmpDir)
    expect(graph.nodes.get("pkg/core.py")?.symbols.sort()).toEqual(["Engine", "compute"])
    expect(graph.nodes.get("pkg/core.py")?.importedBy.sort()).toEqual(["app.py", "pkg/api.py"])
    expect(graph.nodes.get("app.py")?.imports.sort()).toEqual(["pkg/__init__.py", "pkg/api.py", "pkg/core.py"])
    const engine = await analyzeBlastRadius(tmpDir, "pkg/core.py", "Engine")
    expect(engine.directDependents).toEqual(["app.py"])
  })

  it("resolves Go packages via go.mod and tracks used selectors", async () => {
    await writeTree(tmpDir, {
      "go.mod": "module example.com/shop\n\ngo 1.22\n",
      "store/store.go": "package store\n\nfunc Get() {}\nfunc Put() {}\nfunc helper() {}\n",
      "store/store_test.go": "package store\n",
      "api/api.go": 'package api\n\nimport (\n\t"fmt"\n\t"example.com/shop/store"\n)\n\nfunc H() { store.Get(); fmt.Println() }\n',
      "cmd/main.go": 'package main\n\nimport st "example.com/shop/store"\n\nfunc main() { st.Put() }\n',
    })
    const graph = await buildRepoGraph(tmpDir)
    expect(graph.nodes.get("store/store.go")?.symbols.sort()).toEqual(["Get", "Put"])
    expect((await analyzeBlastRadius(tmpDir, "store/store.go", "Get")).directDependents).toEqual(["api/api.go"])
    expect((await analyzeBlastRadius(tmpDir, "store/store.go", "Put")).directDependents).toEqual(["cmd/main.go"])
  })

  it("resolves Rust mod declarations and crate/super use paths", async () => {
    await writeTree(tmpDir, {
      "Cargo.toml": '[package]\nname = "x"\n',
      "src/lib.rs": "pub mod net;\npub mod util;\npub use util::Clock;\n",
      "src/util.rs": "pub struct Clock;\npub fn now() {}\n",
      "src/net/mod.rs": "pub mod client;\nuse crate::util::now;\n",
      "src/net/client.rs": "use super::super::util::Clock;\npub fn connect() {}\n",
    })
    const graph = await buildRepoGraph(tmpDir)
    expect(graph.nodes.get("src/lib.rs")?.imports.sort()).toEqual(["src/net/mod.rs", "src/util.rs"])
    expect(graph.nodes.get("src/net/mod.rs")?.imports.sort()).toEqual(["src/net/client.rs", "src/util.rs"])
    expect(graph.nodes.get("src/net/client.rs")?.imports).toEqual(["src/util.rs"])
    expect((await analyzeBlastRadius(tmpDir, "src/util.rs", "now")).directDependents).toEqual(["src/net/mod.rs"])
  })

  it("ranks heavily imported files first with converged PageRank", async () => {
    await writeTree(tmpDir, {
      "src/types.ts": "export interface T {}\n",
      "src/a.ts": 'import type { T } from "./types"\nexport const a = 1\n',
      "src/b.ts": 'import type { T } from "./types"\nimport { a } from "./a"\nexport const b = a\n',
      "src/c.ts": 'import { b } from "./b"\nexport const c = b\n',
    })
    const map = await buildRepoMap(tmpDir, 4)
    expect(map.topFiles[0].path).toBe("src/types.ts")
    expect(map.topFiles.at(-1)?.path).toBe("src/c.ts")
  })
})
