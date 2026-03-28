// API proxy route — handled by workers/app.ts, this is just a placeholder for React Router
import type { Route } from "./+types/api.hip3";
export async function loader({}: Route.LoaderArgs) {
  return new Response(null, { status: 404 });
}
