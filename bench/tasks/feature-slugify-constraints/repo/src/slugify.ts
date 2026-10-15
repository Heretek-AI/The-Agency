export interface SlugifyOptions {
  separator?: string
  maxLength?: number
}

export function slugify(input: string, options: SlugifyOptions = {}): string {
  throw new Error("not implemented")
}
