import { validateSignup } from "./validation.js"

export function signupHandler(body: { email: string; password: string }) {
  const errors = validateSignup(body)
  return errors.length ? { status: 400, errors } : { status: 201, errors: [] }
}
