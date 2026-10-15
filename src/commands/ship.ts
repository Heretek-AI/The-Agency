export async function registerShipCommand(ctx: any): Promise<void> {
  if (!ctx.command?.transform) return

  await ctx.command.transform((editor: any) => {
    editor.add({
      name: "ship",
      description: "Switch to the SwarmOS Director and orchestrate Architect, Manager, Backend, UI, and QA agents to ship a product",
      execute: async (input: any) => {
        if (ctx.session?.switchAgent) {
          await ctx.session.switchAgent({ sessionID: input.sessionID, agent: "director" })
        }
        if (ctx.session?.prompt) {
          await ctx.session.prompt({
            ...input.prompt,
            sessionID: input.sessionID,
            text: `Execute the SwarmOS 5-Gate Engineering Protocol to build, verify, and ship the following product or feature:\n\n${input.prompt?.text ?? input.prompt ?? ""}`,
            delivery: input.delivery,
          })
        }
      },
    })
  })
}
