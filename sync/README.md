# Ballpark Safari — call-sync backend

A single Cloudflare Worker + Durable Object that holds an append-only log of
everyone's "Call this at-bat" predictions so the leaderboard and the family
"called it!" flash sync across all phones during the live game.

- **Why a Durable Object:** one DO instance per game id is single-threaded and
  strongly consistent, so concurrent appends can't race and every phone reads
  the same log. Workers KV (eventually consistent, last-write-wins on a shared
  key) would drop simultaneous calls.
- **How the client uses it:** scoring stays deterministic on-device. Phones only
  sync the *raw calls*; each phone grades them against the same live MLB feed,
  so everyone computes identical scores. See `SYNC` in `../index.html`.

## Endpoints

| Method | Path                | Auth (`x-safari-pass`) | Purpose |
|--------|---------------------|------------------------|---------|
| GET    | `/calls?game=<id>`  | no                     | read the full call log |
| POST   | `/call?game=<id>`   | yes                    | upsert one call `{id,pid,fam,atBat,choice,ts}` |
| POST   | `/reset?game=<id>`  | yes                    | clear a game's log |

`id` is `"<pid>:<atBat>"` so re-tapping before the pitch overwrites the choice.

## Deploy / redeploy

```sh
cd sync
npx wrangler deploy
```

Live at: https://ballpark-safari-sync.comefollowme.workers.dev

The shared passcode lives in both `src/index.js` (`PASS`) and the client
(`SYNC.pass`) — change both together. It only deters drive-by writes; it is not
real security (the client necessarily contains it).
