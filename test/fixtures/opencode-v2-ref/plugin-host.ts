/**
 * Pinned OpenCode V2 (`v2.0.26`) Plugin Host Surface Reference (`packages/core/src/plugin/host.ts`
 * & `packages/plugin/src/promise/index.ts`).
 *
 * This fixture captures the exact method names, hook literal unions, and replayable `State.create`
 * editor semantics of OpenCode V2 so `bun run contract:check` and `test/host.test.ts` can verify
 * SwarmOS against the real OpenCode V2 contract without needing an external monorepo checkout.
 */

export type SessionHookName = "context" | "generate" | "compaction"
export type ToolHookName = "execute.before" | "execute.after"
export type PermissionHookName = "evaluate"

export interface OpenCodeV2PluginHost {
  location: {
    directory: string
    workspaceID?: string
  }
  agent: {
    transform(fn: (editor: { update(id: string, mutator: (item: any) => void): void }) => void | Promise<void>): Promise<void>
    get(input: { agentID: string }): Promise<{ data?: { id: string; name: string; system?: string; permissions: any[] } }>
  }
  tool: {
    transform(
      fn: (editor: {
        namespace(ns: { name: string; description: string }): void
        add(tool: {
          name: string
          description: string
          options?: { namespace?: string; codemode?: boolean; pinned?: boolean }
          input: Record<string, unknown>
          output: Record<string, unknown>
          execute: (input: any, context?: any) => Promise<{ output: unknown; content: string }>
        }): void
        update(id: string, mutator: (tool: any) => void): void
      }) => void | Promise<void>,
    ): Promise<void>
    hook(name: ToolHookName, handler: (event: any) => Promise<void> | void): Promise<void>
  }
  permission: {
    hook(name: PermissionHookName, handler: (event: any) => Promise<void> | void): Promise<void>
  }
  session: {
    hook(name: SessionHookName, handler: (event: any) => Promise<void> | void): Promise<void>
    prompt(input: { sessionID: string; text: string; delivery?: "steer" | "queue" }): Promise<void>
    switchAgent(input: { sessionID: string; agent: string }): Promise<void>
  }
  command: {
    transform(fn: (editor: { add(cmd: { name: string; description: string; execute: (input: any) => Promise<void> }): void }) => void | Promise<void>): Promise<void>
  }
  skill: {
    transform(
      fn: (editor: {
        add(skill: { id: string; name: string; description: string; autoinvoke?: boolean; path: string; content: string }): void
      }) => void | Promise<void>,
    ): Promise<void>
  }
  experimental: {
    terminal: {
      read(input: { id: string }): Promise<{ data: string }>
    }
  }
}

export const OPENCODE_V2_HOOK_LITERALS = {
  tool: ["execute.before", "execute.after"] as const,
  permission: ["evaluate"] as const,
  session: ["context", "generate", "compaction"] as const,
}
