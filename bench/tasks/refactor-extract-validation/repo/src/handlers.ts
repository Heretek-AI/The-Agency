export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function isStrongPassword(value: string): boolean {
  return value.length >= 10 && /[A-Z]/.test(value) && /[0-9]/.test(value)
}

export function validateSignup(input: { email: string; password: string }): string[] {
  const errors: string[] = []
  if (!isEmail(input.email)) errors.push("invalid email")
  if (!isStrongPassword(input.password)) errors.push("weak password")
  return errors
}

export function signupHandler(body: { email: string; password: string }) {
  const errors = validateSignup(body)
  return errors.length ? { status: 400, errors } : { status: 201, errors: [] }
}
