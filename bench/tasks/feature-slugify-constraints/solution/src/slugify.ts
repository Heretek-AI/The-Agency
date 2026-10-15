export interface SlugifyOptions {
  separator?: string
  maxLength?: number
}

export function slugify(input: string, options: SlugifyOptions = {}): string {
  const sep = options.separator ?? "-"
  const words = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  if (words.length === 0) throw new TypeError("empty slug")

  let slug = words.join(sep)
  const max = options.maxLength
  if (max !== undefined && slug.length > max) {
    let out = ""
    for (const w of words) {
      const next = out ? `${out}${sep}${w}` : w
      if (next.length > max) break
      out = next
    }
    slug = out || words[0].slice(0, max)
  }
  return slug
}
