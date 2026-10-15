import { findUser } from "./users/repo.js"

export function isAdmin(id: number): boolean {
  return findUser(id)?.admin ?? false
}
