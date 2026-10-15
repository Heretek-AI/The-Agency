import { getUserById } from "../users/repo.js"
import { displayName } from "../profile.js"

export function getUserHandler(id: number): { status: number; body: unknown } {
  try {
    const user = getUserById(id)
    return { status: 200, body: { ...user, display: displayName(id) } }
  } catch {
    return { status: 404, body: { error: "not found" } }
  }
}
