/**
 * A recording stand-in for the OpenCode V2 plugin context. It mirrors only the API shape
 * SwarmOS assumes (see src/host/contract.ts); it does not prove the real host matches.
 */
export interface MockHost {
  ctx: any
  tools: Record<string, any>
  namespaces: string[]
  commands: Record<string, any>
  agents: Record<string, any>
  skills: Record<string, any>
  hooks: Record<string, Array<(event: any) => any>>
  prompts: any[]
  fire: (hook: string, event: any) => Promise<any>
}

export function createMockHost(rootDir: string, omit: string[] = []): MockHost {
  const host: MockHost = {
    ctx: {},
    tools: {},
    namespaces: [],
    commands: {},
    agents: {},
    skills: {},
    hooks: {},
    prompts: [],
    fire: async (hook, event) => {
      for (const handler of host.hooks[hook] ?? []) await handler(event)
      return event
    },
  }

  const hookFn = (domain: string) => async (name: string, handler: any) => {
    const key = `${domain}.${name}`
    ;(host.hooks[key] ??= []).push(handler)
  }

  const ctx: any = {
    location: { directory: rootDir },
    agent: {
      transform: async (fn: any) =>
        fn({
          update: (id: string, updater: any) => {
            const item = host.agents[id] ?? { id, permissions: [] }
            updater(item)
            host.agents[id] = item
          },
        }),
      get: async () => ({ data: {} }),
    },
    tool: {
      transform: async (fn: any) =>
        fn({
          namespace: (ns: any) => host.namespaces.push(ns.name),
          add: (tool: any) => {
            const ns = tool.options?.namespace
            host.tools[ns ? `${ns}.${tool.name}` : tool.name] = tool
          },
        }),
      hook: hookFn("tool"),
    },
    permission: { hook: hookFn("permission") },
    session: {
      hook: hookFn("session"),
      prompt: async (p: any) => {
        host.prompts.push(p)
      },
      switchAgent: async () => {},
    },
    command: {
      transform: async (fn: any) =>
        fn({
          add: (cmd: any) => {
            host.commands[cmd.name] = cmd
          },
        }),
    },
    skill: {
      transform: async (fn: any) =>
        fn({
          add: (skill: any) => {
            host.skills[skill.id] = skill
          },
        }),
    },
  }

  for (const cap of omit) {
    const [domain, method] = cap.split(".")
    if (method && ctx[domain]) delete ctx[domain][method]
    else delete ctx[domain]
  }

  host.ctx = ctx
  return host
}
