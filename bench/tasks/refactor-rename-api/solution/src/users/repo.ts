export interface User {
  id: number
  name: string
  admin: boolean
}

const USERS: User[] = [
  { id: 1, name: "Ada", admin: true },
  { id: 2, name: "Linus", admin: false },
]

export function findUser(id: number): User | undefined {
  return USERS.find((u) => u.id === id)
}

/** @deprecated Use findUser. */
export function getUserById(id: number): User {
  const user = findUser(id)
  if (!user) throw new Error(`User ${id} not found`)
  return user
}
