import { afterEach, describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";
import {
  BASELINE_PERMISSIONS,
  RenderError,
  buildPermissions,
  renderAll,
  type RenderInputs,
} from "./render.js";
import { FleetSchema } from "../dispatcher/src/fleet-schema.js";
import { McpRegistrySchema } from "../dispatcher/src/mcp-registry.js";

const tmpRoots: string[] = [];
afterEach(async () => {
  for (const root of tmpRoots.splice(0)) {
    await Bun.$`rm -rf ${root}`.quiet();
  }
});

function expertEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: true,
    profile: "core",
    tier: "standard",
    access: "scoped",
    description: "Fixture expert.",
    handles: ["Fixture work"],
    delegates: ["Nothing elsewhere"],
    proposed_writes: ["src/*"],
    mcp: ["localprobe"],
    skills: ["fixture-skill"],
    image_tools: [],
    egress: [],
    browser: false,
    ...overrides,
  };
}

async function fixtureRoot(
  options: {
    experts?: Record<string, unknown>;
    servers?: Record<string, unknown>;
    allowlistBase?: string;
  } = {},
): Promise<{ root: string; inputs: RenderInputs }> {
  const root = await Bun.$`mktemp -d`
    .quiet()
    .text()
    .then((s) => s.trim());
  tmpRoots.push(root);
  const fleet = {
    version: 1,
    defaults: {
      port: 4096,
      maxConcurrent: 2,
      taskTimeoutSec: 3600,
      resources: { cpus: 2, memory: "4g" },
    },
    tiers: { standard: "{env:AGENCY_MODEL}" },
    experts: options.experts ?? {
      writer: expertEntry(),
      reader: expertEntry({ access: "ro", proposed_writes: [], mcp: ["remoteprobe"], skills: [] }),
      sleeper: expertEntry({ enabled: false }),
    },
  };
  const registry = {
    servers: options.servers ?? {
      localprobe: { requires: [], config: { type: "local", command: ["probe-server"] } },
      remoteprobe: {
        requires: [],
        config: { type: "remote", url: "https://probe.example.com/mcp" },
      },
    },
  };
  const parsedFleet = FleetSchema.parse(fleet);
  const parsedRegistry = McpRegistrySchema.parse(registry);
  const expertsDir = `${root}/experts`;
  await Bun.$`mkdir -p ${expertsDir}/writer/config/skills/fixture-skill`.quiet();
  await Bun.write(`${expertsDir}/writer/config/skills/fixture-skill/SKILL.md`, "# fixture\n");
  const inputs: RenderInputs = {
    fleet: parsedFleet,
    registry: parsedRegistry,
    protocol: "# protocol\n",
    allowlistBase: options.allowlistBase ?? "# base\nprobe.example.com\n",
    squidTemplate: "port @@PORT@@ list @@ALLOWLIST_PATH@@\n",
    expertsDir,
    caddyDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  };
  return { root, inputs };
}

describe("render", () => {
  test("output is stable across two runs", async () => {
    const { root, inputs } = await fixtureRoot();
    const first = await renderAll(root, inputs);
    const second = await renderAll(root, inputs);
    expect(second).toEqual(first);
  });

  test("a disabled expert produces no config and no service", async () => {
    const { root, inputs } = await fixtureRoot();
    const files = await renderAll(root, inputs);
    const paths = files.map((f) => f.path);
    expect(paths.some((p) => p.includes("/sleeper/"))).toBe(false);
    const compose = files.find((f) => f.path.endsWith("docker-compose.yml"))!;
    const doc = parseYaml(compose.content.replace(/^#.*\n/, "")) as {
      services: Record<string, unknown>;
    };
    expect(Object.keys(doc.services).sort()).toEqual([
      "dispatcher",
      "egress",
      "gateway",
      "reader",
      "verifier",
      "writer",
    ]);
  });

  test("the gateway routes the dispatcher and every expert without buffering", async () => {
    const { root, inputs } = await fixtureRoot();
    const files = await renderAll(root, inputs);
    const caddy = files.find((f) => f.path.endsWith("gateway/Caddyfile"))!;
    expect(caddy.content).toContain("http://agency.localhost");
    expect(caddy.content).toContain("reverse_proxy dispatcher:8080");
    expect(caddy.content).toContain("http://writer.agency.localhost");
    expect(caddy.content).toContain("reverse_proxy writer:4096");
    expect(caddy.content).toContain("flush_interval -1");
    expect(caddy.content).not.toContain("sleeper.agency.localhost");
    const compose = files.find((f) => f.path.endsWith("docker-compose.yml"))!;
    const doc = parseYaml(compose.content.replace(/^#.*\n/, "")) as {
      services: Record<
        string,
        {
          image?: string;
          ports?: string[];
          cap_add?: string[];
          cap_drop?: string[];
          environment?: Record<string, string>;
          networks?: string[];
        }
      >;
    };
    expect(doc.services["gateway"]?.image).toContain("caddy@sha256:");
    expect(doc.services["gateway"]?.ports).toEqual(["127.0.0.1:${AGENCY_HTTP_PORT}:8080"]);
    // The Caddy binary carries cap_net_bind_service as a file capability;
    // dropping ALL without re-adding it makes exec fail, so the renderer
    // grants exactly that one capability back.
    expect(doc.services["gateway"]?.cap_drop).toEqual(["ALL"]);
    expect(doc.services["gateway"]?.cap_add).toEqual(["NET_BIND_SERVICE"]);
    // Defect: the dispatcher bound loopback inside its container, so the
    // gateway's dispatcher:8080 route was refused with 502. The renderer
    // binds all interfaces so the gateway can reach it over the fleet
    // network.
    expect(doc.services["dispatcher"]?.environment?.["DISPATCHER_HOSTNAME"]).toBe("0.0.0.0");
    // Defect: the daemon silently drops published ports on an
    // internal-network-only container, so the gateway is dual-homed with
    // the egress proxy while experts stay internal-only.
    expect(doc.services["gateway"]?.networks).toEqual(["fleet", "outside"]);
    expect(doc.services["writer"]?.networks).toEqual(["fleet"]);
    expect(doc.services["dispatcher"]?.ports).toBeUndefined();
    expect(doc.services["writer"]?.ports).toBeUndefined();
  });

  test("refuses an expert naming an MCP key missing from the registry", async () => {
    const { root, inputs } = await fixtureRoot({
      experts: { writer: expertEntry({ mcp: ["nosuchserver"] }) },
    });
    await expect(renderAll(root, inputs)).rejects.toThrow(RenderError);
  });

  test("refuses an expert naming a skill with no SKILL.md", async () => {
    const { root, inputs } = await fixtureRoot({
      experts: { writer: expertEntry({ skills: ["ghost-skill"] }) },
    });
    await expect(renderAll(root, inputs)).rejects.toThrow(RenderError);
  });

  test("refuses a remote MCP host missing from the egress allowlist", async () => {
    const { root, inputs } = await fixtureRoot({ allowlistBase: "# base\n" });
    await expect(renderAll(root, inputs)).rejects.toThrow(/egress allowlist/);
  });

  test("refuses a permission list with an ask effect", async () => {
    const tainted = [
      ...BASELINE_PERMISSIONS,
      { action: "shell", resource: "rm *", effect: "ask" as const },
    ];
    expect(() => buildPermissions("writer", [], tainted)).toThrow(RenderError);
  });

  test("refuses a permission list whose first rule is not deny-all", async () => {
    const tainted = BASELINE_PERMISSIONS.slice(1);
    expect(() => buildPermissions("writer", [])).not.toThrow();
    void tainted;
    const reordered = [...BASELINE_PERMISSIONS.slice(1), BASELINE_PERMISSIONS[0]!];
    expect(() => buildPermissions("writer", [], reordered)).toThrow(RenderError);
  });

  test("the Director's ruleset differs as 9.6 says", async () => {
    const expert = buildPermissions("writer", ["fleet"]);
    const director = buildPermissions("director", ["fleet"]);
    expect(expert).toContainEqual({ action: "shell", resource: "*", effect: "allow" });
    expect(director).not.toContainEqual({ action: "shell", resource: "*", effect: "allow" });
    expect(director).toContainEqual({ action: "shell", resource: "git log*", effect: "allow" });
    expect(director).toContainEqual({ action: "subagent", resource: "*", effect: "deny" });
    expect(director).toContainEqual({ action: "fleet_*", resource: "*", effect: "allow" });
    expect(director[0]).toEqual({ action: "*", resource: "*", effect: "deny" });
  });
});
