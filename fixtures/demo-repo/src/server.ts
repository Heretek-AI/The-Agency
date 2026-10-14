/** Tiny HTTP service for the Stage 1b demo workspace. */

export function createResponse(request: Request): Response {
  const url = new URL(request.url);
  if (url.pathname === "/health") {
    return Response.json({ status: "ok" });
  }
  if (url.pathname === "/hello") {
    const name = url.searchParams.get("name") ?? "world";
    return Response.json({ greeting: `hello, ${name}` });
  }
  return new Response("not found", { status: 404 });
}

if (import.meta.main) {
  const port = Number(process.env["PORT"] ?? 3000);
  Bun.serve({ port, fetch: createResponse });
  console.log(`demo listening on :${port}`);
}
