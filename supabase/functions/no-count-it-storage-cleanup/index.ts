import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Content-Type": "application/json" } });
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const suppliedSecret = req.headers.get("x-cleanup-secret") ?? "";
    if (!url || !serviceRoleKey) return json({ error: "Server configuration missing" }, 500);
    if (suppliedSecret.length !== 64) return json({ error: "Unauthorized" }, 401);
    const db = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authorized, error: authError } = await db.rpc("no_count_it_cleanup_authorized", { p_secret: suppliedSecret });
    if (authError || authorized !== true) return json({ error: "Unauthorized" }, 401);
    const now = new Date().toISOString();
    const { data: expired, error: queryError } = await db.from("games_no_count_it_rounds")
      .select("id,image_path").lte("delete_after", now).not("image_path", "is", null).neq("image_path", "")
      .order("delete_after", { ascending: true }).limit(100);
    if (queryError) {
      console.error("NoCountIt cleanup query failed", queryError.message);
      return json({ error: "Could not list expired scenes" }, 500);
    }
    if (!expired?.length) return json({ scanned: 0, deleted: 0, remainingBatch: false });
    const paths = [...new Set(expired.map((row) => row.image_path as string))];
    const { error: removeError } = await db.storage.from("no-count-it-scenes").remove(paths);
    if (removeError) {
      console.error("NoCountIt Storage deletion failed", removeError.message);
      return json({ error: "Could not delete expired scenes" }, 502);
    }
    const ids = expired.map((row) => row.id);
    const { error: updateError } = await db.from("games_no_count_it_rounds").update({ image_path: null }).in("id", ids);
    if (updateError) {
      console.error("NoCountIt cleanup metadata update failed", updateError.message);
      return json({ error: "Files deleted, but cleanup metadata update failed" }, 500);
    }
    return json({ scanned: expired.length, deleted: paths.length, remainingBatch: expired.length === 100 });
  } catch (error) {
    console.error("NoCountIt cleanup failed", error instanceof Error ? error.message : "Unknown error");
    return json({ error: "Internal cleanup error" }, 500);
  }
});
