/**
 * Compose-hardening assertion for acceptance check 1b/03. Parses the
 * generated docker-compose.yml and fails with reasons on the first
 * violation. Exits 0 printing "hardening ok" only when every rule holds.
 */
import { parse as parseYaml } from "yaml";
import { FleetSchema, enabledExperts } from "../../dispatcher/src/fleet-schema.js";

const root = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const doc = parseYaml(await Bun.file(`${root}/docker-compose.yml`).text()) as {
  services?: Record<string, Record<string, unknown>>;
};
const fleet = FleetSchema.parse(parseYaml(await Bun.file(`${root}/fleet.yaml`).text()));
const enabled = enabledExperts(fleet);
const errors: string[] = [];

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

for (const name of enabled) {
  const svc = doc.services?.[name];
  if (svc === undefined) {
    errors.push(`${name}: missing service`);
    continue;
  }
  const access = fleet.experts[name]?.access;
  if (JSON.stringify(svc["cap_drop"]) !== JSON.stringify(["ALL"]))
    errors.push(`${name}: cap_drop != [ALL]`);
  const securityOpt = svc["security_opt"];
  if (!isStringList(securityOpt) || !securityOpt.includes("no-new-privileges:true")) {
    errors.push(`${name}: missing no-new-privileges`);
  }
  if (typeof svc["pids_limit"] !== "number") errors.push(`${name}: missing pids_limit`);
  if (svc["cpus"] === undefined || svc["mem_limit"] === undefined) {
    errors.push(`${name}: missing cpus or mem_limit`);
  }
  if (JSON.stringify(svc["networks"]) !== JSON.stringify(["fleet"])) {
    errors.push(`${name}: networks != [fleet]`);
  }
  if ("ports" in svc) errors.push(`${name}: publishes ports`);
  if (svc["privileged"] === true) errors.push(`${name}: privileged`);
  const vols = Array.isArray(svc["volumes"]) ? svc["volumes"] : [];
  for (const vol of vols) {
    if (typeof vol !== "string") continue;
    if (vol.includes("docker.sock")) errors.push(`${name}: mounts a daemon socket`);
    if (vol.startsWith("./") || vol.startsWith("/")) {
      const mode = vol.split(":")[2] ?? "";
      if (!mode.split(",").includes("z")) errors.push(`${name}: bind without :z: ${vol}`);
    }
  }
  const cfg = vols.filter((v) => typeof v === "string" && v.endsWith(":/etc/agency:ro,z"));
  if (cfg.length !== 1) errors.push(`${name}: config mount is not exactly one read-only bind`);
  const work = vols.filter((v) => typeof v === "string" && v.includes(":/work:"));
  if (work.length !== 1) {
    errors.push(`${name}: /work mount missing`);
  } else if (access === "ro" && !(work[0] as string).endsWith(":/work:ro,z")) {
    errors.push(`${name}: ro expert mounts /work writable: ${work[0]}`);
  } else if (access === "scoped" && !(work[0] as string).endsWith(":/work:rw,z")) {
    errors.push(`${name}: scoped expert mounts /work read-only: ${work[0]}`);
  }
}

const egress = doc.services?.["egress"];
if (egress === undefined) {
  errors.push("egress: missing service");
} else {
  const nets = egress["networks"];
  if (
    !isStringList(nets) ||
    JSON.stringify([...nets].sort()) !== JSON.stringify(["fleet", "outside"])
  ) {
    errors.push("egress: networks != [fleet, outside]");
  }
  if ("ports" in egress) errors.push("egress: publishes ports");
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("hardening ok");
