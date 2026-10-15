function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function inviteAdmin(email: string) {
  if (!isEmail(email)) return { ok: false as const, error: "invalid email" }
  return { ok: true as const, email: email.toLowerCase() }
}
