export interface Page<T> {
  items: T[]
  page: number
  totalPages: number
}

export function paginate<T>(items: T[], page: number, size: number): Page<T> {
  const start = (page - 1) * size
  const totalPages = Math.ceil(items.length / size)
  return { items: items.slice(start, start + size), page, totalPages }
}
