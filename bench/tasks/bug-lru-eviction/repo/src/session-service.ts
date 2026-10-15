import { LRUCache } from "./cache/lru.js"

export interface Session {
  userId: string
  lastSeen: number
}

export class SessionService {
  private cache: LRUCache<string, Session>

  constructor(capacity = 3) {
    this.cache = new LRUCache(capacity)
  }

  login(userId: string): void {
    this.cache.set(userId, { userId, lastSeen: Date.now() })
  }

  touch(userId: string): boolean {
    const s = this.cache.get(userId)
    if (!s) return false
    s.lastSeen = Date.now()
    return true
  }

  isLoggedIn(userId: string): boolean {
    return this.cache.has(userId)
  }
}
