import { findUser } from "../users/repo.js"
import { displayName } from "../profile.js"

export function getUserHandler(id: number): { status: number; body: unknown } {
  const user = findUser(id)
  if (!user) return { status: 404, body: { error: "not found" } }
  return { status: 200, body: { ...user, display: displayName(id) } }
}
