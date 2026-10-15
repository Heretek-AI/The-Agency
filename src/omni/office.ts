import { execFile } from "node:child_process"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export const SUPPORTED_OFFICE_EXTENSIONS = new Set([
  ".docx",
  ".xlsx",
  ".xls",
  ".pptx",
  ".sqlite",
  ".sqlite3",
  ".db",
  ".csv",
  ".tsv",
])

const PYTHON_UNIVERSAL_EXTRACTOR = `
import sys, os, json, csv

NL = chr(10)
TAB = chr(9)
path = sys.argv[1]
ext = os.path.splitext(path)[1].lower()

if ext in (".csv", ".tsv"):
    delim = TAB if ext == ".tsv" else ","
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        reader = list(csv.reader(f, delimiter=delim))
    out = [f"# Tabular Dataset: {os.path.basename(path)} ({len(reader)} rows)"]
    for r_idx, row in enumerate(reader[:100]):
        cells = [c.strip().replace(NL, " ") for c in row[:25]]
        out.append("| " + " | ".join(cells) + " |")
        if r_idx == 0:
            out.append("| " + " | ".join(["---"] * len(cells)) + " |")
    print(NL.join(out))

elif ext == ".docx":
    import docx
    doc = docx.Document(path)
    out = ["# Word Document: " + os.path.basename(path), ""]
    for p in doc.paragraphs:
        if p.text.strip():
            style = p.style.name if p.style else ""
            prefix = "## " if "Heading 1" in style else ("### " if "Heading" in style else "")
            out.append(prefix + p.text)
    for idx, table in enumerate(doc.tables, 1):
        out.append(NL + f"### Table {idx}")
        for r_idx, row in enumerate(table.rows):
            cells = [c.text.strip().replace(NL, " ") for c in row.cells]
            out.append("| " + " | ".join(cells) + " |")
            if r_idx == 0:
                out.append("| " + " | ".join(["---"] * len(cells)) + " |")
    print(NL.join(out))

elif ext in (".xlsx", ".xls"):
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=False)
    wb_val = openpyxl.load_workbook(path, data_only=True)
    out = ["# Excel Workbook: " + os.path.basename(path)]
    for name in wb.sheetnames:
        sheet = wb[name]
        sheet_val = wb_val[name]
        out.append(NL + f"## Sheet: {name} ({sheet.max_row} rows x {sheet.max_column} cols)")
        max_r = min(sheet.max_row, 100)
        max_c = min(sheet.max_column, 20)
        for r in range(1, max_r + 1):
            row_cells = []
            for c in range(1, max_c + 1):
                f_val = sheet.cell(r, c).value
                v_val = sheet_val.cell(r, c).value
                if isinstance(f_val, str) and f_val.startswith("="):
                    row_cells.append(f"{v_val} ({f_val})")
                else:
                    row_cells.append("" if v_val is None else str(v_val).replace(NL, " "))
            if any(row_cells):
                out.append("| " + " | ".join(row_cells) + " |")
                if r == 1:
                    out.append("| " + " | ".join(["---"] * len(row_cells)) + " |")
    print(NL.join(out))

elif ext == ".pptx":
    from pptx import Presentation
    prs = Presentation(path)
    out = [f"# PowerPoint Presentation: {os.path.basename(path)} ({len(prs.slides)} slides)"]
    for idx, slide in enumerate(prs.slides, 1):
        out.append(NL + f"## Slide {idx}")
        for shape in slide.shapes:
            if shape.has_text_frame:
                for p in shape.text_frame.paragraphs:
                    if p.text.strip():
                        out.append("- " + p.text.strip())
    print(NL.join(out))

elif ext in (".sqlite", ".sqlite3", ".db"):
    import sqlite3
    conn = sqlite3.connect(path)
    cur = conn.cursor()
    tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    out = [f"# SQLite Database: {os.path.basename(path)}"]
    for t in tables:
        cols = cur.execute(f"PRAGMA table_info('{t}')").fetchall()
        col_names = [c[1] + " (" + c[2] + ")" for c in cols]
        count = cur.execute(f"SELECT COUNT(*) FROM '{t}'").fetchone()[0]
        out.append(NL + f"## Table: {t} ({count} rows)" + NL + "Columns: " + ", ".join(col_names))
        rows = cur.execute(f"SELECT * FROM '{t}' LIMIT 10").fetchall()
        for r in rows:
            out.append("- " + json.dumps(r, default=str))
    print(NL.join(out))
`

export async function extractOfficeOrDataFile(
  rootDir: string,
  targetPath: string,
): Promise<string | undefined> {
  const abs = path.resolve(rootDir, targetPath)
  const ext = path.extname(abs).toLowerCase()
  if (!SUPPORTED_OFFICE_EXTENSIONS.has(ext)) return undefined

  const { stdout } = await execFileAsync("python3", ["-c", PYTHON_UNIVERSAL_EXTRACTOR, abs], {
    cwd: rootDir,
    timeout: 15000,
  })
  return stdout.trim()
}

export async function renderDocumentPreviews(
  rootDir: string,
  targetPath: string,
): Promise<{ pdfPath: string; previewPngs: string[] }> {
  const abs = path.resolve(rootDir, targetPath)
  const ext = path.extname(abs).toLowerCase()
  const previewDir = path.join(rootDir, ".opencode", "artifacts", "previews")
  await fs.mkdir(previewDir, { recursive: true })

  let pdfPath = abs
  if ([".docx", ".pptx", ".xlsx"].includes(ext)) {
    await execFileAsync(
      "libreoffice",
      ["--headless", "--nologo", "--nolockcheck", "--norestore", "--convert-to", "pdf", "--outdir", previewDir, abs],
      { cwd: rootDir, timeout: 30000 },
    )
    const stem = path.basename(abs, ext)
    pdfPath = path.join(previewDir, `${stem}.pdf`)
  }

  const stem = path.basename(pdfPath, ".pdf")
  const pyRender = `
import sys, os, json, pypdfium2 as pdfium
pdf_path, out_dir, stem = sys.argv[1], sys.argv[2], sys.argv[3]
pdf = pdfium.PdfDocument(pdf_path)
paths = []
for i, page in enumerate(pdf, start=1):
    out_file = os.path.join(out_dir, f"{stem}_page_{i}.png")
    page.render(scale=2).to_pil().save(out_file)
    paths.append(out_file)
pdf.close()
print(json.dumps(paths))
`
  const { stdout } = await execFileAsync("python3", ["-c", pyRender, pdfPath, previewDir, stem], {
    cwd: rootDir,
    timeout: 20000,
  })
  const previewPngs = JSON.parse(stdout.trim()) as string[]
  return { pdfPath, previewPngs }
}

export function registerOfficeTools(editor: any, rootDir: string): void {
  editor.namespace({
    name: "office",
    description:
      "Universal Office & Data Suite for extracting `.docx`, `.xlsx`, `.pptx`, `.sqlite`, `.csv` files and rendering high-DPI page PNG previews for visual self-critique.",
  })

  editor.add({
    name: "extract_document",
    description:
      "Extract structured Markdown (headings, tables, formulas, slides, or SQLite schemas/rows) from `.docx`, `.xlsx`, `.pptx`, `.sqlite`, `.db`, `.csv`, or `.tsv` files.",
    options: { namespace: "office", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the Office document or database file" },
      },
      required: ["path"],
    },
    output: { type: "object" },
    execute: async (input: { path: string }) => {
      const extracted = await extractOfficeOrDataFile(rootDir, input.path)
      if (!extracted) {
        throw new Error(`Unsupported or empty office/data file: ${input.path}`)
      }
      return {
        output: { path: input.path, content: extracted },
        content: extracted,
      }
    },
  })

  editor.add({
    name: "render_preview",
    description:
      "Convert a `.docx`, `.pptx`, `.xlsx`, or `.pdf` document into per-page PNG images inside `.opencode/artifacts/previews/` so you can call `read` on each PNG to visually inspect layout, alignment, and pagination.",
    options: { namespace: "office", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the generated .pdf, .docx, .pptx, or .xlsx file" },
      },
      required: ["path"],
    },
    output: { type: "object" },
    execute: async (input: { path: string }) => {
      const res = await renderDocumentPreviews(rootDir, input.path)
      return {
        output: res,
        content: `Rendered ${res.previewPngs.length} page preview PNG(s):\n${res.previewPngs.join("\n")}`,
      }
    },
  })

  // Also upgrade OpenCode V2's native `read` tool in-place so calling `read` on .docx/.xlsx/.pptx/.sqlite works transparently!
  if (typeof editor.update === "function") {
    try {
      editor.update("read", (tool: any) => {
        const origExecute = tool.execute
        tool.execute = async (input: any, context: any) => {
          if (typeof input?.path === "string") {
            const ext = path.extname(input.path).toLowerCase()
            if ([".docx", ".xlsx", ".xls", ".pptx", ".sqlite", ".sqlite3", ".db"].includes(ext)) {
              const extracted = await extractOfficeOrDataFile(rootDir, input.path)
              if (extracted !== undefined) {
                return {
                  output: { type: "office-extracted", path: input.path, content: extracted },
                  content: extracted,
                }
              }
            }
          }
          return origExecute(input, context)
        }
      })
    } catch {
      // ignore if read is not registered yet
    }
  }
}
