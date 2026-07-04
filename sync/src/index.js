import { DurableObject } from "cloudflare:workers";

/* Shared game passcode. Also baked into the client. Not real security — it just
   keeps drive-by writes off a public endpoint for a private family game. */
const PASS = "leavitt2026";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type,x-safari-pass",
  "Access-Control-Max-Age": "86400",
};

/* One Durable Object instance per game id = a single, strongly-consistent,
   single-threaded coordinator. Appends can't race; every reader sees the same log. */
export class CallLog extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS calls (
          id     TEXT PRIMARY KEY,
          pid    INTEGER NOT NULL,
          fam    INTEGER NOT NULL,
          atBat  INTEGER NOT NULL,
          choice TEXT NOT NULL,
          ts     INTEGER NOT NULL
        )
      `);
    });
  }

  // id is deterministic per (person, at-bat) so re-tapping before the pitch
  // just overwrites the choice — "change your mind" works, no duplicates.
  add(call) {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO calls (id,pid,fam,atBat,choice,ts) VALUES (?,?,?,?,?,?)",
      call.id, call.pid | 0, call.fam | 0, call.atBat | 0, String(call.choice), Number(call.ts) || 0
    );
    // keep storage bounded — newest 5000 calls is plenty for one night
    this.ctx.storage.sql.exec(
      "DELETE FROM calls WHERE id NOT IN (SELECT id FROM calls ORDER BY ts DESC LIMIT 5000)"
    );
    return this.list();
  }

  list() {
    return this.ctx.storage.sql
      .exec("SELECT id,pid,fam,atBat,choice,ts FROM calls ORDER BY ts ASC")
      .toArray();
  }

  clear() {
    this.ctx.storage.sql.exec("DELETE FROM calls");
    return [];
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const game = (url.searchParams.get("game") || "default").slice(0, 64);
    const stub = env.CALLS.get(env.CALLS.idFromName(game));

    try {
      if (url.pathname === "/calls" && request.method === "GET") {
        return json({ calls: await stub.list() });
      }

      if (url.pathname === "/call" && request.method === "POST") {
        if (request.headers.get("x-safari-pass") !== PASS) return json({ error: "bad pass" }, 403);
        const c = await request.json().catch(() => null);
        if (!c || typeof c.id !== "string" || typeof c.choice !== "string")
          return json({ error: "bad call" }, 400);
        const calls = await stub.add({
          id: c.id.slice(0, 64),
          pid: c.pid,
          fam: c.fam,
          atBat: c.atBat,
          choice: c.choice.slice(0, 8),
          ts: c.ts,
        });
        return json({ calls });
      }

      if (url.pathname === "/reset" && request.method === "POST") {
        if (request.headers.get("x-safari-pass") !== PASS) return json({ error: "bad pass" }, 403);
        return json({ calls: await stub.clear() });
      }

      return json({ ok: true, service: "ballpark-safari-sync" });
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },
};
