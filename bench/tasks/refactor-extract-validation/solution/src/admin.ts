import { isEmail } from "./validation.js"

export function inviteAdmin(email: string) {
  if (!isEmail(email)) return { ok: false as const, error: "invalid email" }
  return { ok: true as const, email: email.toLowerCase() }
}
