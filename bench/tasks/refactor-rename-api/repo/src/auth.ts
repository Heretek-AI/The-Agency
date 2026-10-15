import { getUserById } from "./users/repo.js"

export function isAdmin(id: number): boolean {
  try {
    return getUserById(id).admin
  } catch {
    return false
  }
}
