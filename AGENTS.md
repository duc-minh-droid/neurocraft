# NeuroCraft: agent guide

A text-driven 3D world. The user types into the chat bar ("a castle on the hill", "make it fly"). A built-in LLM agent
(`pipeline/agent`) turns each message into **world tool calls** that edit `world.json`. The dev server pushes every change
to the page over its websocket, so edits appear in about a second with no reload.

## Commands
- `npm run dev`: world at http://localhost:5173 (the agent runs inside the dev server)
- `npm run typecheck`, `npm test`, `npm run build`: verification
- `npx tsx scripts/say.ts "msg" ["msg"...]`: send chat messages to the running world and print each run's steps (the fastest way to test the agent)
- `npx tsx scripts/snap.ts out.png [url] [waitMs]`: headless screenshot (`?follow=<entityId>` frames an object)
- `npx tsx scripts/record-demo.ts --name demo --prompt "..." [--prompt ...]`: record the real flow to `docs/media/<name>.mp4/.gif` (waiting is fast-forwarded; `--recut` re-cuts the last raw take)
- `npm run nc -- <cmd>`: low-level asset pipeline CLI (search, make, animate, retexture, balance, log, inbox)
- Keys live in `.env`: `GROQ_API_KEY` (agent), `SKETCHFAB_API_TOKEN` (library downloads), `TRIPO_API_KEY` (optional generation). Never print or commit them.

## Layout
- `world.json`: **the world as data** (time of day + objects: asset, position, height, tint, clip, count/scatter, behavior, bone effects). Types in `shared/world.ts`.
- `public/assets/<id>/model.glb` + `meta.json`, plus `public/assets/index.json` (rebuilt by the pipeline). Served statically and loaded at runtime, so new models don't trigger reloads.
- `pipeline/world.ts`: server-side store (commit with undo history, file watch for hand edits).
- `pipeline/agent/`: `agent.ts` (LLM ↔ tools loop), `tools.ts` (zod-validated tools), `context.ts` (scene summary, landmarks, here/it), `assets.ts` (library reuse → search → rank → LLM pick → fetch → optional generation).
- `pipeline/llm.ts`: OpenAI-compatible client. Groq if `GROQ_API_KEY` is set (falls back across models when rate limited), else local Ollama; override with `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL`.
- `src/engine/WorldObjects.tsx`: renders world.json objects with `Entity` + behaviors. `src/engine/worldState.ts` / `assets.ts`: live registries (keep them free of runtime-changing imports so their websocket subscriptions survive hot updates).
- `src/entities/*.tsx`: optional hand-written objects for things world.json can't express (auto-loaded).
- `src/world/`: terrain (`heightfield.ts`), lighting presets per time of day (`World.tsx`), camera director (glides to focused objects).

## Agent tools
`add_object`, `update_object` (size/scale_factor, tint, clip, count, behavior, bones, `around` to center on another object), `move_object`,
`remove_object`, `set_time`, `focus_camera`, `undo`, `ask_devin` (queues requests that need new code to the relay inbox below).
- Places: `"here"` (double-clicked point), `"it"` (double-clicked object), an object id, or `"x,z"`. Landmarks (hilltops, lakes) are listed in the scene context. Non-exact placements avoid overlapping other objects.
- Clips are validated against the asset's `meta.clips`; tool errors go back to the LLM, which retries.
- A message costs one LLM call when every tool succeeds (the Groq free tier limits tokens per minute).

## Extending
- New capability = a new tool in `pipeline/agent/tools.ts` (zod schema + executor + label in `agent.ts`) and, if it needs rendering, a field in `shared/world.ts` handled in `WorldObjects.tsx`.
- New behavior = component in `src/engine/behaviors/`, entry in `BEHAVIORS`, and a case in `withBehavior()`.
- Test agent changes with `scripts/say.ts`, and add unit tests in `pipeline/agent.test.ts` (uses a temp world file via `NC_WORLD_FILE`).

## Activity feed
Everything streams to the Activity panel: CLI/agent → `.neurocraft/activity.jsonl` → Vite plugin (`pipeline/vite-plugin.ts`) →
websocket `nc:activity` → `src/engine/activity/ActivityPanel.tsx`. Steps can carry `focus` (the camera glides to that object).
When working outside the agent (e.g. Devin in chat), narrate with `npm run -s nc -- log --run "<request>" "..."` and close with `--done`.

## Other chat modes (`NC_CHAT_MODE`)
- `agent` (default): built-in LLM agent.
- `relay`: messages queue in `.neurocraft/inbox.jsonl` for a Devin chat looping on `npm run -s nc -- inbox --wait --timeout 240` (run it in the background so the chat isn't blocked; `inbox --stop` to end).
- `cli`: spawns `devin -p` per message. Requires a working standalone `devin auth login`, which currently fails on this machine.

## Gotchas
- Negative coordinates in the CLI must use `=`: `--at=-49,-49`.
- Windows: killing the dev-server shell can orphan Vite on :5173. Free it with `taskkill //PID <pid> //T //F` (find it via `netstat -ano`).
- Screenshots/previews go to `%TEMP%/neurocraft/`, because files under gitignored dirs (`.cache`, `.neurocraft`) can't be read by the agent's file tool.
- Only CC-BY / CC-BY-SA / CC0 models are auto-picked. Attribution is in each `meta.json`; keep the README credits in sync when the world's models change.
