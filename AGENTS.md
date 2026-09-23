# NeuroCraft: agent guide

A prompt-driven 3D world. The user describes things ("red dragon here", "make it fly"). The agent turns each request into
**pipeline commands** (to get assets) plus **code edits** (entity files). The browser hot-reloads.

## Commands
- `npm run dev`: world at http://localhost:5173
- `npm run nc -- <cmd>`: asset pipeline (`npm run nc` alone prints help)
- `npm run typecheck`, `npm test`, `npm run build`: verification
- Keys live in `.env` (`TRIPO_API_KEY`, `SKETCHFAB_API_TOKEN`). Never print or commit them.

## Layout
- `assets/<id>/model.glb` + `meta.json`: normalized assets. `meta.json` lists bones, nodes, clips, height, source/license.
- `src/entities/<name>.tsx`: **one file per object in the world**, auto-loaded via `import.meta.glob`. Edit these for follow-ups.
- `src/engine/`: `Entity`, `Place`, `Scatter`, behaviors (import everything from `'../engine'`).
- `src/world/`: terrain (`heightfield.ts` height function, `Terrain.tsx` mesh), sky/lights (`World.tsx`). Edit these for world-level requests (time of day, fog, water, terrain shape).
- `pipeline/`: CLI, Tripo + Sketchfab providers, glTF steps, kind profiles.
- `.neurocraft/{cursor,selection,scene}.json`: written by the running browser. Read these with `npm run nc -- status`.

## Live activity feed (required)
The page has an **Activity** panel that streams everything the agent does. For every user request:
1. Pick a short run title = the user's request, e.g. `R="put a man in the middle"`.
2. Narrate decisions: `npm run -s nc -- log --run "$R" "Searching Sketchfab for a rigged man"`.
3. Pass `--run "$R"` to every pipeline command (`search`, `make`, `animate`, `retexture`, `spawn`). Their steps
   (download %, Tripo progress %, rig-check, rig, animations, save, spawn, thumbnails, preview renders) stream automatically.
4. Entity file edits are captured automatically with a diff, attached to the open run.
5. Close the run: `npm run -s nc -- log --run "$R" --done "Summary of what changed"` (or `--error "..."`).

How it works: CLI → `.neurocraft/activity.jsonl` → Vite plugin (`pipeline/vite-plugin.ts`) tails it → HMR websocket
event `nc:activity` → `src/engine/activity/ActivityPanel.tsx`. Preview images are served from `%TEMP%/neurocraft` at `/__nc/preview/*`.
Windows: killing the dev-server shell can orphan Vite on :5173. Free the port with `taskkill //PID <pid> //T //F` (find it via `netstat -ano`).

## In-page chat (text box → Devin)
Default **relay mode**: the text box queues messages in `.neurocraft/inbox.jsonl` for the Devin chat the user already talks to.
- To listen, loop: `npm run -s nc -- inbox --wait --timeout 240`. It blocks, then prints `{"message", "run"}` (or `{"message": null}` on timeout).
- Handle each message exactly like a chat request, using the printed `run` as the `--run` title (narrate, pipeline, edits, `--done`),
  then call `inbox --wait` again. The page shows listening / working / offline from `.neurocraft/listener.json`.
- When you stop listening: `npm run -s nc -- inbox --stop`. Messages sent while offline stay queued (`nc inbox` lists them).

Alternative **cli mode** (`NC_CHAT_MODE=cli npm run dev`): each message runs `devin -p "<wrapped message>" --permission-mode dangerous
--respect-workspace-trust false [-r <session>]` in the repo (`pipeline/chat.ts`, spawned by the Vite dev server).
- One ongoing session: the first message creates it, and its id is saved to `.neurocraft/chat-session.json`. Later messages resume it. "new chat" resets it.
- The wrapped prompt gives the agent a run title (message + time) and tells it to follow this file, so its narration, pipeline steps
  and entity edits land in the same card. Its final stdout reply is shown as the card's closing line.
- Bypass mode was chosen by the user (personal use). Only one message runs at a time. **Stop** kills the process tree.
- cli mode requires the standalone CLI to be logged in (`devin auth login`). On this machine it still reports "Not logged in"
  even after a browser login wrote `credentials.toml`. Unresolved, which is why relay is the default.
- Endpoints: `POST /__nc/chat {message}`, `POST /__nc/chat/cancel`, `POST /__nc/chat/reset`, `GET /__nc/chat/status`. Busy state is pushed as the `nc:chat` HMR event.

## Resolving the user's words
- "here" = `cursor` (the user double-clicked the ground). `spawn`/`make` use it by default when `--at` is omitted.
- "it"/"that" = `selection` (the user double-clicked an object); otherwise the most recently spawned entity.
- Relative placement ("next to the house"): read `scene` (live world positions/sizes of all entities).

## Workflow for "<thing> here"
1. Choose `--kind`: `character` (humanoid), `creature` (animal/monster), `vehicle`, `prop`, `building`, `plant`.
   character/creature get Tripo rig-check → auto-rig → default animations; the others stay static.
2. Try Sketchfab first (free): `npm run nc -- search "<thing>" --thumbs [--animated] [--max-faces 100000]`.
   Look at thumbnails in `%TEMP%/neurocraft/thumbs/<uid>.jpg` with the read tool. If one matches the request (style, color, pose), use
   `npm run nc -- make "<prompt>" --id <id> --kind <kind> --from sketchfab:<uid>`.
   Prefer results under 100k faces and 30 MB. Models with their own skeleton/clips keep them (no Tripo rig).
3. Otherwise generate (costs Tripo credits): `npm run nc -- make "<descriptive prompt incl. color/material>" --id <id> --kind <kind>`.
   Put color and style in the prompt (e.g. "red dragon with dark red scales, wings spread"). Preview renders are saved to `%TEMP%/neurocraft/previews/`.
   For image→3D: `--image path/or/url`. Use `--height <m>` to set real-world size (dragon ~4, car ~1.6, house ~7).
4. `make` writes `src/entities/<id>.tsx` automatically (use `--no-spawn` to skip, `--name` for a second instance).
   Then verify: `npm run nc -- status` (entity appears in scene) and/or a Playwright screenshot saved outside the repo.

Credits (approx): generate 20–40, rig 25, each animation 10, retexture 10–20. Rig-check is free. `meta.credits` tracks spend.

## Follow-ups are code edits in `src/entities/<name>.tsx`
- Size: `<Entity height={6} />` (meters) or `scale={2}`. Facing fix: `rotation={90}` (behaviors assume +Z forward).
- Recolor: `tint="#1d4ed8"` (+ `tintStrength`). New texture instead: `npm run nc -- retexture <id> "<texture prompt>"`.
- Animation clip: `clip="walk"` (names in meta.clips), `speed={1.5}`. More clips: `npm run nc -- animate <id> jump dance_01`.
  Biped presets: idle walk run jump climb dive slash shoot hurt fall turn (+90 `biped:*` on rig v1). Quadruped: `quadruped:walk`.
  There is **no fly/swim preset**, so use procedural behaviors.
- Motion wrappers (go inside `<Place>`, around `<Entity>`; coordinates are relative to Place):
  - `<Fly radius altitude speed path="circle|figure8|[[x,z],...]" bank bob>`: flying with banking
  - `<Drive radius speed path>`: ground path; `<Swim depth>`: underwater path; `<PathMotion ...>`: fully custom
  - `<Wander radius speed>`: random roaming on land; `<Float>`, `<Spin speed>`, `<Sway>` (plants)
- Bone/node behaviors (go **inside** `<Entity>`; `match` is a regex over names in meta.bones / meta.nodes):
  - `<FlapBones match={/wing/i} amplitude={0.6} frequency={1.5} axis="z" />`: wings, fins, ears (auto-mirrors L/R)
  - `<WiggleBones match={/tail/i} />`: travelling wave for tails, snakes, tentacles
  - `<SpinNodes match={/wheel/i} speed={8} axis="x" />`: wheels, rotors, propellers
  - If nothing matches, the console warns. Check meta.json names and fall back to whole-body motion.
- Many copies: `<Place at={[x,z]}><Scatter count={30} radius={25} spacing={3} minHeight={WATER_LEVEL + 0.3}>{(it) => <Entity asset="pine" id={\`pine-${it.index}\`} rotation={it.rotation} scale={it.scale} />}</Scatter></Place>`
- Remove an object: delete its entity file (ask the user first). The asset folder can stay.

## Gotchas
- Negative coordinates must use `=`: `--at=-49,-49` (Node's parseArgs treats `-49` as a flag).
- Write entity files only after the asset exists, or the page logs "Asset not found" until it lands.

## Verifying visually
- `http://localhost:5173/?follow=<entityId>` trails the camera behind an entity (useful for screenshots of moving things).
- Dev builds expose `window.__nc.entities` (id → `{ asset, object, size }`) for Playwright `browser_evaluate` checks,
  e.g. confirm a vehicle moves nose-first by comparing named front/back nodes against its velocity.
- `npm run nc -- balance` shows Tripo credits. Generation fails with code 2010 when the balance is 0.

## Conventions
- Asset ids and entity names are kebab-case. Each entity file default-exports one component.
- Don't hand-edit `assets/*/meta.json` except `defaultHeight`. Re-run the pipeline instead.
- Sketchfab CC-BY assets need attribution. It's recorded in each `meta.json`, but the on-screen credits overlay was removed at the
  user's request (personal use). Add credits back before publishing anything.
- UI (dev only, `src/engine/Hud.tsx`): Activity panel top-right (the ongoing run, or collapsed history when idle) and the chat bar
  bottom-center. Double-click still records "here"/"it" silently, with no on-screen hints or marker.
- Screenshots/previews go to `%TEMP%/neurocraft/`, because files under gitignored dirs (`.cache`, `.neurocraft`) can't be read by the agent's file tool.
