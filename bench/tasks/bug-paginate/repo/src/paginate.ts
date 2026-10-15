export interface Page<T> {
  items: T[]
  page: number
  totalPages: number
}

export function paginate<T>(items: T[], page: number, size: number): Page<T> {
  const start = (page - 1) * size - (page > 1 ? 1 : 0)
  const totalPages = Math.floor(items.length / size) + 1
  return { items: items.slice(start, start + size), page, totalPages }
}
