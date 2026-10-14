/**
 * Fleet renderer (Stage 1b, Step 4). From fleet.yaml, mcp/registry.jsonc,
 * and shared/templates/, generates per-expert opencode.jsonc, AGENTS.md,
 * and mcp-requirements.json, plus docker-compose.yml and the egress
 * proxy's allowlist configuration.
 *
 * Generated files carry a "GENERATED, do not edit" header and are
 * byte-for-byte reproducible. `--check` exits 1 when any generated file is
 * stale or missing. The renderer refuses to write (exit 1) when any rule
 * below is violated; every refusal names the expert and the cause.
 */
import { parse as parseJsonc } from "jsonc-parser";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { FleetSchema, enabledExperts, type FleetConfig } from "../dispatcher/src/fleet-schema.js";
import { McpRegistrySchema, type McpRegistry } from "../dispatcher/src/mcp-registry.js";

export class RenderError extends Error {}

export interface PermissionRule {
  action: string;
  resource: string;
  effect: "allow" | "deny";
}

/** Baseline permission ruleset (shared context 9.6). No rule may use ask. */
export const BASELINE_PERMISSIONS: PermissionRule[] = [
  { action: "*", resource: "*", effect: "deny" },
  { action: "read", resource: "*", effect: "allow" },
  { action: "glob", resource: "*", effect: "allow" },
  { action: "grep", resource: "*", effect: "allow" },
  { action: "skill", resource: "*", effect: "allow" },
  { action: "webfetch", resource: "*", effect: "allow" },
  { action: "websearch", resource: "*", effect: "allow" },
  { action: "subagent", resource: "explore", effect: "allow" },
  { action: "external_directory", resource: "/work/*", effect: "allow" },
  { action: "external_directory", resource: "/artifacts/*", effect: "allow" },
  { action: "edit", resource: "/artifacts/*", effect: "allow" },
  { action: "read", resource: "*.env", effect: "deny" },
  { action: "read", resource: "*.env.*", effect: "deny" },
  { action: "read", resource: "*.env.example", effect: "allow" },
  { action: "shell", resource: "*", effect: "allow" },
  { action: "shell", resource: "git push*", effect: "deny" },
  { action: "shell", resource: "git merge*", effect: "deny" },
  { action: "shell", resource: "git rebase*", effect: "deny" },
  { action: "shell", resource: "git switch*", effect: "deny" },
  { action: "shell", resource: "git checkout*", effect: "deny" },
  { action: "shell", resource: "git worktree*", effect: "deny" },
  { action: "shell", resource: "git tag*", effect: "deny" },
];

/**
 * Permission list for one expert: the baseline (or the Director variant,
 * shared context 9.6) plus one allow per MCP server the expert uses.
 * The baseline is taken as loosely-typed input and validated: any effect
 * other than allow or deny is refused, as is a missing deny-all first
 * rule.
 */
export interface PermissionInput {
  action: string;
  resource: string;
  effect: string;
}
export function buildPermissions(
  expertName: string,
  mcpKeys: string[],
  baseline: PermissionInput[] = BASELINE_PERMISSIONS,
): PermissionRule[] {
  const rules: PermissionInput[] =
    expertName === "director"
      ? baseline.map((rule) => {
          if (rule.action === "subagent") return { ...rule, resource: "*", effect: "deny" };
          return rule;
        })
      : [...baseline];
  const withoutShellAll =
    expertName === "director"
      ? rules.flatMap((rule) =>
          rule.action === "shell" && rule.resource === "*" && rule.effect === "allow"
            ? [
                { action: "shell", resource: "git log*", effect: "allow" },
                { action: "shell", resource: "git status*", effect: "allow" },
                { action: "shell", resource: "git diff*", effect: "allow" },
                { action: "shell", resource: "git show*", effect: "allow" },
              ]
            : [rule],
        )
      : rules;
  const full: PermissionInput[] = [
    ...withoutShellAll,
    ...mcpKeys.map((key) => ({
      action: `${key}_*`,
      resource: "*",
      effect: "allow",
    })),
  ];
  const validated: PermissionRule[] = full.map((rule) => {
    if (rule.effect !== "allow" && rule.effect !== "deny") {
      throw new RenderError(
        `refusing to render ${expertName}: permission rule has effect ${rule.effect}`,
      );
    }
    return { action: rule.action, resource: rule.resource, effect: rule.effect };
  });
  const first = validated[0];
  if (
    first === undefined ||
    first.action !== "*" ||
    first.resource !== "*" ||
    first.effect !== "deny"
  ) {
    throw new RenderError(
      `refusing to render ${expertName}: first permission rule is not deny-all`,
    );
  }
  return validated;
}

/** Hostnames of every remote MCP server in the registry. */
export function remoteMcpHosts(registry: McpRegistry): Set<string> {
  const hosts = new Set<string>();
  for (const entry of Object.values(registry.servers)) {
    if (entry.config.type === "remote") hosts.add(new URL(entry.config.url).hostname);
  }
  return hosts;
}

/**
 * Fleet-network hosts that bypass the egress proxy (NO_PROXY) and must
 * never appear on its allowlist: the proxy could not resolve them, and
 * routing internal traffic through it would be wrong.
 */
export const INTERNAL_HOSTS = new Set([
  "dispatcher",
  "verifier",
  "egress",
  "localhost",
  "127.0.0.1",
]);

export interface RenderInputs {
  fleet: FleetConfig;
  registry: McpRegistry;
  protocol: string;
  allowlistBase: string;
  squidTemplate: string;
  expertsDir: string;
  caddyDigest: string;
}

export async function loadInputs(root: string): Promise<RenderInputs> {
  const fleetText = await Bun.file(`${root}/fleet.yaml`).text();
  const fleet = FleetSchema.parse(parseYaml(fleetText));
  const registryText = await Bun.file(`${root}/mcp/registry.jsonc`).text();
  const registry = McpRegistrySchema.parse(
    parseJsonc(registryText, [], { allowTrailingComma: true }),
  );
  const protocol = await Bun.file(`${root}/shared/FLEET_PROTOCOL.md`).text();
  const allowlistBase = await Bun.file(`${root}/shared/templates/allowlist-base.txt`).text();
  const squidTemplate = await Bun.file(`${root}/shared/templates/squid.conf.tmpl`).text();
  const versions = await Bun.file(`${root}/versions.env`).text();
  const digest = /^CADDY_DIGEST=(.+)$/m.exec(versions)?.[1]?.trim();
  if (digest === undefined || !/^sha256:[0-9a-f]{64}$/.test(digest)) {
    throw new RenderError("refusing to render: versions.env holds no CADDY_DIGEST pin");
  }
  return {
    fleet,
    registry,
    protocol,
    allowlistBase,
    squidTemplate,
    expertsDir: `${root}/experts`,
    caddyDigest: digest,
  };
}

function parseAllowlistBase(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

/** Global allowlist: base plus every expert's egress additions. */
export function buildAllowlist(fleet: FleetConfig, base: string[]): string[] {
  const set = new Set(base);
  for (const expert of Object.values(fleet.experts)) {
    for (const host of expert.egress) set.add(host);
  }
  return [...set].sort();
}

export interface GeneratedFile {
  path: string;
  content: string;
}

/** Render every generated file. Throws RenderError on any refusal. */
export async function renderAll(root: string, inputs: RenderInputs): Promise<GeneratedFile[]> {
  const { fleet, registry, protocol, allowlistBase, squidTemplate, expertsDir } = inputs;
  const enabled = enabledExperts(fleet);
  const base = parseAllowlistBase(allowlistBase);
  const allowlist = buildAllowlist(fleet, base);

  // Refusal: a remote MCP host missing from the allowlist. Fleet-network
  // hosts (INTERNAL_HOSTS) bypass the proxy and are exempt.
  const allowed = new Set(allowlist);
  const missingHosts = [...remoteMcpHosts(registry)]
    .filter((host) => !allowed.has(host) && !INTERNAL_HOSTS.has(host))
    .sort();
  if (missingHosts.length > 0) {
    throw new RenderError(
      `refusing to render: remote MCP host(s) not on the egress allowlist: ${missingHosts.join(", ")}`,
    );
  }

  const files: GeneratedFile[] = [];

  for (const name of enabled) {
    const expert = fleet.experts[name]!;
    // Refusal: an MCP key missing from the registry.
    for (const key of expert.mcp) {
      if (registry.servers[key] === undefined) {
        throw new RenderError(
          `refusing to render ${name}: MCP key "${key}" missing from the registry`,
        );
      }
    }
    // Refusal: a skill with no SKILL.md.
    for (const skill of expert.skills) {
      const skillFile = Bun.file(`${expertsDir}/${name}/config/skills/${skill}/SKILL.md`);
      if (!(await skillFile.exists())) {
        throw new RenderError(
          `refusing to render ${name}: skill "${skill}" has no ${expertsDir}/${name}/config/skills/${skill}/SKILL.md`,
        );
      }
    }
    // Refusal: a remote MCP host of this expert missing from its allowlist.
    const expertAllowed = new Set([...base, ...expert.egress]);
    for (const key of expert.mcp) {
      const config = registry.servers[key]!.config;
      if (config.type === "remote") {
        const host = new URL(config.url).hostname;
        if (!expertAllowed.has(host) && !INTERNAL_HOSTS.has(host)) {
          throw new RenderError(
            `refusing to render ${name}: remote MCP host "${host}" (server "${key}") not on its egress allowlist`,
          );
        }
      }
    }

    const permissions = buildPermissions(name, expert.mcp);
    const servers: Record<string, unknown> = {};
    for (const key of expert.mcp) servers[key] = registry.servers[key]!.config;
    const opencode = {
      $schema: "https://opencode.ai/config.json",
      model: "{env:AGENCY_MODEL}",
      default_agent: name,
      update: "disable",
      share: "disabled",
      snapshots: true,
      agents: {
        build: { disabled: true },
        plan: { disabled: true },
        general: { disabled: true },
      },
      permissions,
      mcp: {
        timeout: { startup: 60000, catalog: 30000, execution: 300000 },
        servers,
      },
    };
    files.push({
      path: `${expertsDir}/${name}/config/opencode.jsonc`,
      content:
        `// GENERATED, do not edit. Rendered by scripts/render.ts from fleet.yaml and mcp/registry.jsonc.\n` +
        `${JSON.stringify(opencode, null, 2)}\n`,
    });
    files.push({
      path: `${expertsDir}/${name}/config/AGENTS.md`,
      content: `<!-- GENERATED, do not edit. Source: shared/FLEET_PROTOCOL.md -->\n${protocol}${
        protocol.endsWith("\n") ? "" : "\n"
      }`,
    });
    const requirements: Record<string, unknown> = {};
    for (const key of expert.mcp) {
      const entry = registry.servers[key]!;
      requirements[key] = { requires: entry.requires, config: entry.config };
    }
    files.push({
      path: `${expertsDir}/${name}/config/mcp-requirements.json`,
      content: `${JSON.stringify(
        {
          _generated:
            "GENERATED, do not edit. Rendered by scripts/render.ts from fleet.yaml and mcp/registry.jsonc.",
          mcpServers: requirements,
        },
        null,
        2,
      )}\n`,
    });
  }

  files.push({ path: `${root}/docker-compose.yml`, content: renderCompose(fleet, inputs) });
  files.push({
    path: `${root}/gateway/Caddyfile`,
    content: renderCaddyfile(fleet),
  });
  files.push({
    path: `${root}/egress/allowlist.txt`,
    content:
      `# GENERATED, do not edit. Rendered by scripts/render.ts from shared/templates/allowlist-base.txt and fleet.yaml.\n` +
      allowlist.map((host) => `${host}\n`).join(""),
  });
  files.push({
    path: `${root}/egress/squid.conf`,
    content: squidTemplate
      .replaceAll("@@ALLOWLIST_PATH@@", "/etc/squid/allowlist.txt")
      .replaceAll("@@PORT@@", "3128"),
  });
  return files;
}

function renderCompose(fleet: FleetConfig, inputs: RenderInputs): string {
  const { caddyDigest } = inputs;
  const enabled = enabledExperts(fleet);
  const upper = (name: string): string => name.toUpperCase().replace(/-/g, "_");
  const services: Record<string, unknown> = {};
  const volumes: Record<string, unknown> = { artifacts: {} };

  for (const name of enabled) {
    const expert = fleet.experts[name]!;
    const browser = expert.browser;
    const memLimit = browser ? "6g" : fleet.defaults.resources.memory;
    const volumeMode = expert.access === "ro" ? "ro" : "rw";
    const service: Record<string, unknown> = {
      container_name: `agency-${name}`,
      build: {
        context: ".",
        dockerfile: `experts/${name}/Dockerfile`,
        args: {
          OPENCODE_VERSION: "${OPENCODE_VERSION}",
          AGENT_UID: "${AGENT_UID}",
          AGENT_GID: "${AGENT_GID}",
        },
      },
      image: `agency-${name}:\${OPENCODE_VERSION}`,
      restart: "unless-stopped",
      working_dir: "/work",
      networks: ["fleet"],
      cap_drop: ["ALL"],
      security_opt: ["no-new-privileges:true"],
      pids_limit: 1024,
      cpus: fleet.defaults.resources.cpus,
      mem_limit: memLimit,
      healthcheck: {
        test: [
          "CMD-SHELL",
          "curl -fsS --noproxy '*' -u opencode:$$OPENCODE_PASSWORD http://127.0.0.1:4096/api/info >/dev/null",
        ],
        interval: "15s",
        timeout: "5s",
        retries: 10,
        start_period: "30s",
      },
      environment: {
        AGENCY_EXPERT: name,
        OPENCODE_CONFIG_DIR: "/etc/agency",
        OPENCODE_DISABLE_PROJECT_CONFIG: "1",
        OPENCODE_CLIENT: "agency",
        OPENCODE_PASSWORD: `\${PW_${upper(name)}}`,
        AGENCY_MODEL: "${AGENCY_MODEL}",
        HTTP_PROXY: `http://${name}:\${PROXY_PW_${upper(name)}}@egress:3128`,
        HTTPS_PROXY: `http://${name}:\${PROXY_PW_${upper(name)}}@egress:3128`,
        http_proxy: `http://${name}:\${PROXY_PW_${upper(name)}}@egress:3128`,
        https_proxy: `http://${name}:\${PROXY_PW_${upper(name)}}@egress:3128`,
        NO_PROXY: "localhost,127.0.0.1,egress,dispatcher,verifier",
        no_proxy: "localhost,127.0.0.1,egress,dispatcher,verifier",
      },
      env_file: [
        { path: ".env.provider", required: true },
        { path: `secrets/${name}.env`, required: false },
      ],
      volumes: [
        `./experts/${name}/config:/etc/agency:ro,z`,
        `\${AGENCY_WORKSPACE:-./workspace}:/work:${volumeMode},z`,
        "artifacts:/artifacts",
        `${name}-data:/home/agent/.local/share/opencode`,
        `${name}-state:/home/agent/.local/state/opencode`,
        `${name}-cache:/home/agent/.cache`,
      ],
    };
    if (browser) service["shm_size"] = "1g";
    services[name] = service;
    volumes[`${name}-data`] = {};
    volumes[`${name}-state`] = {};
    volumes[`${name}-cache`] = {};
  }

  const egressEnv: Record<string, string> = {};
  for (const name of enabled) egressEnv[`PROXY_PW_${upper(name)}`] = `\${PROXY_PW_${upper(name)}}`;
  // The verifier proxies dependency installs under its own identity.
  egressEnv["PROXY_PW_VERIFIER"] = "${PROXY_PW_VERIFIER}";
  services["verifier"] = {
    container_name: "agency-verifier",
    build: {
      context: ".",
      dockerfile: "verifier/Dockerfile",
      args: {
        OPENCODE_VERSION: "${OPENCODE_VERSION}",
        AGENT_UID: "${AGENT_UID}",
        AGENT_GID: "${AGENT_GID}",
      },
    },
    image: "agency-verifier:1.0.0",
    restart: "unless-stopped",
    working_dir: "/app",
    networks: ["fleet"],
    cap_drop: ["ALL"],
    security_opt: ["no-new-privileges:true"],
    pids_limit: 512,
    cpus: 2,
    mem_limit: "4g",
    healthcheck: {
      test: ["CMD-SHELL", "curl -fsS --noproxy '*' http://127.0.0.1:8080/healthz >/dev/null"],
      interval: "15s",
      timeout: "5s",
      retries: 10,
      start_period: "20s",
    },
    environment: {
      VERIFIER_TOKEN: "${VERIFIER_TOKEN}",
      VERIFIER_PORT: "8080",
      HTTP_PROXY: "http://verifier:${PROXY_PW_VERIFIER}@egress:3128",
      HTTPS_PROXY: "http://verifier:${PROXY_PW_VERIFIER}@egress:3128",
      http_proxy: "http://verifier:${PROXY_PW_VERIFIER}@egress:3128",
      https_proxy: "http://verifier:${PROXY_PW_VERIFIER}@egress:3128",
      NO_PROXY: "localhost,127.0.0.1,egress,dispatcher,verifier",
      no_proxy: "localhost,127.0.0.1,egress,dispatcher,verifier",
    },
    volumes: [
      "${AGENCY_WORKSPACE:-./workspace}:/work:rw,z",
      "artifacts:/artifacts",
      "verifier-cache:/home/agent/.cache",
    ],
  };
  volumes["verifier-cache"] = {};
  services["egress"] = {
    container_name: "agency-egress",
    build: { context: "./egress" },
    image: "agency-egress:1.0.0",
    restart: "unless-stopped",
    networks: ["fleet", "outside"],
    cap_drop: ["ALL"],
    security_opt: ["no-new-privileges:true"],
    pids_limit: 256,
    cpus: 1,
    mem_limit: "1g",
    healthcheck: {
      test: ["CMD-SHELL", "curl -sS -o /dev/null --noproxy '*' http://127.0.0.1:3128/"],
      interval: "15s",
      timeout: "5s",
      retries: 10,
      start_period: "20s",
    },
    environment: egressEnv,
    volumes: [
      "./egress/allowlist.txt:/etc/squid/allowlist.txt:ro,z",
      "./egress/squid.conf:/etc/squid/squid.conf:ro,z",
    ],
  };

  const dispatcherEnv: Record<string, string> = {
    AGENCY_MODEL: "${AGENCY_MODEL}",
    FLEET_MCP_TOKEN: "${FLEET_MCP_TOKEN}",
    VERIFIER_TOKEN: "${VERIFIER_TOKEN}",
    DISPATCHER_STATE_DIR: "/data",
    DISPATCHER_REGISTRY_DIR: "/data/registry",
    DISPATCHER_WORKSPACE: "/work",
    DISPATCHER_ARTIFACTS: "/artifacts",
    DISPATCHER_ALLOWLIST: "/data/registry/allowlist.yaml",
  };
  for (const name of enabled) dispatcherEnv[`PW_${upper(name)}`] = `\${PW_${upper(name)}}`;
  const healthyDeps: Record<string, { condition: string }> = {};
  for (const name of [...enabled, "verifier"]) healthyDeps[name] = { condition: "service_healthy" };
  services["dispatcher"] = {
    container_name: "agency-dispatcher",
    build: {
      context: ".",
      dockerfile: "dispatcher/Dockerfile",
      args: {
        OPENCODE_VERSION: "${OPENCODE_VERSION}",
        AGENT_UID: "${AGENT_UID}",
        AGENT_GID: "${AGENT_GID}",
      },
    },
    image: "agency-dispatcher:1.0.0",
    restart: "unless-stopped",
    working_dir: "/app",
    networks: ["fleet"],
    cap_drop: ["ALL"],
    security_opt: ["no-new-privileges:true"],
    pids_limit: 512,
    cpus: 2,
    mem_limit: "4g",
    depends_on: healthyDeps,
    healthcheck: {
      test: ["CMD-SHELL", "curl -fsS --noproxy '*' http://127.0.0.1:8080/healthz >/dev/null"],
      interval: "15s",
      timeout: "10s",
      retries: 5,
      start_period: "30s",
    },
    environment: dispatcherEnv,
    volumes: [
      "${AGENCY_WORKSPACE:-./workspace}:/work:rw,z",
      "artifacts:/artifacts",
      "./state:/data:rw,z",
      "dispatcher-cache:/home/agent/.cache",
    ],
  };
  volumes["dispatcher-cache"] = {};
  services["gateway"] = {
    container_name: "agency-gateway",
    image: `caddy@${caddyDigest}`,
    restart: "unless-stopped",
    networks: ["fleet"],
    cap_drop: ["ALL"],
    security_opt: ["no-new-privileges:true"],
    pids_limit: 256,
    cpus: 1,
    mem_limit: "512m",
    depends_on: { dispatcher: { condition: "service_healthy" } },
    healthcheck: {
      test: ["CMD-SHELL", "curl -fsS --noproxy '*' http://127.0.0.1:8080/healthz >/dev/null"],
      interval: "15s",
      timeout: "5s",
      retries: 10,
      start_period: "20s",
    },
    ports: ["127.0.0.1:${AGENCY_HTTP_PORT}:8080"],
    volumes: ["./gateway/Caddyfile:/etc/caddy/Caddyfile:ro,z", "gateway-data:/data"],
  };
  volumes["gateway-data"] = {};

  const doc = {
    services,
    networks: { fleet: { internal: true }, outside: { driver: "bridge" } },
    volumes,
  };
  return (
    `# GENERATED, do not edit. Rendered by scripts/render.ts from fleet.yaml.\n` +
    stringifyYaml(doc)
  );
}

/**
 * Gateway routing (Stage 1d, Step 4): agency.localhost reaches the
 * Dispatcher; each <name>.agency.localhost reaches that expert's
 * OpenCode server as the debug fallback. Buffering is off
 * (flush_interval -1) so SSE streams pass through unbuffered.
 */
function renderCaddyfile(fleet: FleetConfig): string {
  const lines = [
    "# GENERATED, do not edit. Rendered by scripts/render.ts from fleet.yaml.",
    "{",
    "\tadmin off",
    "\thttp_port 8080",
    "}",
    "",
    "http://agency.localhost {",
    "\treverse_proxy dispatcher:8080 {",
    "\t\tflush_interval -1",
    "\t}",
    "}",
  ];
  for (const name of enabledExperts(fleet)) {
    lines.push(
      "",
      `http://${name}.agency.localhost {`,
      `\treverse_proxy ${name}:4096 {`,
      "\t\tflush_interval -1",
      "\t}",
      "}",
    );
  }
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  const check = args.includes("--check");
  const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
  let inputs: RenderInputs;
  try {
    inputs = await loadInputs(root);
  } catch (error) {
    console.error(`render: cannot load inputs: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
  let files: GeneratedFile[];
  try {
    files = await renderAll(root, inputs);
  } catch (error) {
    console.error(error instanceof RenderError ? `render: ${error.message}` : `render: ${error}`);
    process.exit(1);
  }
  if (check) {
    const stale: string[] = [];
    for (const file of files) {
      const existing = Bun.file(file.path);
      if (!(await existing.exists()) || (await existing.text()) !== file.content)
        stale.push(file.path);
    }
    if (stale.length > 0) {
      console.error(
        `render-check: stale or missing generated files:\n${stale.map((p) => `  ${p}`).join("\n")}`,
      );
      process.exit(1);
    }
    console.log(`render-check: ${files.length} generated files are current`);
    return;
  }
  for (const file of files) {
    await Bun.write(file.path, file.content);
  }
  console.log(`render: wrote ${files.length} generated files`);
}

if (import.meta.main) await main();
