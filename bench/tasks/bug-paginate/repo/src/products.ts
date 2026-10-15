import { paginate } from "./paginate.js"

export const PRODUCTS = Array.from({ length: 23 }, (_, i) => ({ id: i + 1, name: `Product ${i + 1}` }))

export function productPage(page: number, size = 10) {
  return paginate(PRODUCTS, page, size)
}
