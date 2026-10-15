import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Shell } from "./components/Shell.tsx";
import { useAuth } from "./auth.tsx";
import { AuditLog, QueuePlaceholder, ReposPlaceholder, Settings } from "./views/placeholders.tsx";
import { Fleet } from "./views/Fleet.tsx";
import { Home } from "./views/Home.tsx";
import { Login } from "./views/Login.tsx";
import { MissionDetail } from "./views/MissionDetail.tsx";
import { Missions } from "./views/Missions.tsx";

const rootRoute = createRootRoute({
  component: Root,
});

function Root(): ReactNode {
  const { user, loading } = useAuth();
  if (loading) return <p className="p-4 text-sm text-[#8b949e]">Loading session…</p>;
  if (user === null) return <Login />;
  return <Shell />;
}

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Home });
const missionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/missions",
  component: Missions,
});
const missionDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/missions/$missionId",
  component: MissionDetail,
});
const fleetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/fleet",
  component: Fleet,
});
const reposRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/repos",
  component: ReposPlaceholder,
});
const queueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/queue",
  component: QueuePlaceholder,
});
const auditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/audit",
  component: AuditLog,
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: Settings,
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  missionsRoute,
  missionDetailRoute,
  fleetRoute,
  reposRoute,
  queueRoute,
  auditRoute,
  settingsRoute,
]);

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function App(): ReactNode {
  return <RouterProvider router={router} />;
}
