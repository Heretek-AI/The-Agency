export function loadConfig(text: string): { port: number; host: string } {
  const env: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const [k, v] = line.split("=")
    if (k) env[k.trim()] = (v ?? "").trim()
  }
  return { port: Number(env.PORT ?? 3000), host: env.HOST ?? "localhost" }
}
