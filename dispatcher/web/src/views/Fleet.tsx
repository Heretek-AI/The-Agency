import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { api } from "../api.ts";
import { HealthDot } from "../components/status.tsx";
import { BorderBeam } from "../magic/magic.tsx";

export function Fleet(): ReactNode {
  const fleet = useQuery({
    queryKey: ["fleet"],
    queryFn: () => api.fleet(),
    refetchInterval: 10_000,
  });

  if (fleet.isLoading) return <p className="text-sm text-[#8b949e]">Loading fleet…</p>;
  if (fleet.isError || fleet.data === undefined)
    return (
      <p role="alert" className="text-sm text-[#ff8fab]">
        {fleet.error instanceof Error ? fleet.error.message : "fleet unavailable"}
      </p>
    );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-3">
      <h1 className="text-base font-semibold">Fleet</h1>
      <div data-testid="fleet-grid" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {fleet.data.experts.map((expert) => (
          <BorderBeam key={expert.name}>
            <article
              data-testid={`expert-card-${expert.name}`}
              className="rounded-lg bg-[#0d1118] p-3"
            >
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">{expert.name}</h2>
                <span className="ml-auto">
                  <HealthDot health={expert.health} />
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-[#8b949e]">{expert.description}</p>
              <dl className="mt-2 grid grid-cols-2 gap-1 text-xs">
                <div>
                  <dt className="text-[#8b949e]">Access</dt>
                  <dd>{expert.access}</dd>
                </div>
                <div>
                  <dt className="text-[#8b949e]">Active tasks</dt>
                  <dd data-testid={`expert-load-${expert.name}`}>{expert.load}</dd>
                </div>
              </dl>
              <div className="mt-2 flex items-center gap-2 text-xs">
                <span className="text-[#8b949e]">CPU/mem live in container;</span>
                <a
                  href={`http://${expert.name}:4096`}
                  data-testid={`expert-debug-${expert.name}`}
                  className="text-[#00f0ff] hover:underline"
                  title={`Open ${expert.name} debug UI (admin fallback)`}
                >
                  debug UI
                </a>
              </div>
            </article>
          </BorderBeam>
        ))}
      </div>
    </div>
  );
}
