import { parseEnv } from "./env.js"

export function loadConfig(text: string): { port: number; host: string } {
  const env = parseEnv(text)
  return { port: Number(env.PORT ?? 3000), host: env.HOST ?? "localhost" }
}
