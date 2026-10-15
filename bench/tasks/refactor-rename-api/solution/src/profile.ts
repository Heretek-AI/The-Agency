import { findUser } from "./users/repo.js"

export function displayName(id: number): string {
  const user = findUser(id)
  if (!user) throw new Error(`User ${id} not found`)
  return user.name.toUpperCase()
}
