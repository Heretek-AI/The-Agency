import { getUserById } from "./users/repo.js"

export function displayName(id: number): string {
  return getUserById(id).name.toUpperCase()
}
