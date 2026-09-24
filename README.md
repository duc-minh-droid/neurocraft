<div align="center">

# NeuroCraft

### Describe a world. Watch it appear.

A living 3D world you shape by typing. Ask for a castle, a dragon, a pack of wolves, a sunset: it shows up in seconds, already lit, animated and moving.

<img src="docs/media/demo.gif" alt="Typing 'a castle on the hill over there' makes a castle appear on a hill; the dragon grows and circles it; a wolf pack roams nearby; the world turns to golden sunset" width="100%" />

<sub>Real, unscripted run: an AI handled all four requests, with only the waiting fast-forwarded. <a href="docs/media/demo.mp4">Watch the full-quality video</a>.</sub>

</div>

---

## The idea

Building 3D worlds normally means modeling, rigging, texturing, animating and scripting. NeuroCraft hides all of that behind a single text bar.

You say what you want. The AI works out the rest: it finds the right model, sizes it to real-world scale, places it where it makes sense and brings it to life. Then you keep talking:

> **"a castle on the hill over there"**: a castle rises on the hilltop
>
> **"make the red dragon twice as big and circle above the castle"**: the dragon grows and banks around the towers
>
> **"add a pack of wolves roaming near the castle"**: five wolves appear and start to roam
>
> **"turn it into a golden sunset"**: the sun drops, the light warms, shadows stretch across the valley

Changes to things already in the world land in **about a second**. Brand-new objects take a few seconds. No menus, no asset stores, no editors. Just intent.

## What you can do

| | |
|---|---|
| **Create anything** | Characters, creatures, vehicles, buildings, props, plants: *"a windmill next to the forest"*, *"a knight"*, *"three wolves"* |
| **Change anything** | *"make it twice as big"*, *"paint the dragon gold"*, *"two more wolves"*, *"delete a man"* |
| **Make it move** | *"make it fly around the castle"*, *"the car should drive around"*, *"make the wolves wander"* |
| **Set the mood** | *"golden sunset"*, *"make it night"*, *"back to daytime"* |
| **Refer naturally** | *"on the hill"*, *"by the lake"*, *"next to the castle"*; double-click a spot for *"here"*, an object for *"it"* |
| **Take it back** | *"undo that"* |

While it works, a live panel shows each step as it happens: what it's looking for, what it picked, what changed. Then it steps aside and shows history, and the camera glides to whatever just changed.

## How it works

```
text bar ─► AI with world tools ─► instant world edits (size, color, motion, light, placement)
                                └► new objects: search a large 3D library → pick the best match → fetch → place
```

1. **Understand**: a fast language model reads your message together with a live description of the world (every object, where the hills and lakes are, where you're looking, what you clicked).
2. **Act**: it calls world tools (`add`, `change`, `move`, `remove`, `set time`, `undo`). They're validated and applied immediately, and a bad call gets corrected on the spot.
3. **Find**: new objects come from a large free 3D library. Candidates are ranked (relevance, polish, whether they can already move) and the AI picks one. Anything downloaded once is reused instantly.
4. **Bring it to life**: models keep their own animations. Flying, driving, swimming, roaming and swaying are procedural, so anything can do them.
5. **Remember**: the world is plain data (`world.json`), so it survives reloads, can be undone, and is easy to share.

## Run it

```bash
git clone https://github.com/duc-minh-droid/neurocraft
cd neurocraft
npm install
cp .env.example .env   # then add your keys (below)
npm run dev            # open http://localhost:5173
```

| Key | What for | Cost |
|---|---|---|
| `GROQ_API_KEY` | The AI that understands your requests ([console.groq.com](https://console.groq.com)) | Free tier |
| `SKETCHFAB_API_TOKEN` | Downloading new models from the library ([sketchfab.com](https://sketchfab.com) → Settings → Password & API) | Free |
| `TRIPO_API_KEY` | *Optional:* generating brand-new models when nothing suitable exists | Paid credits |

No Groq key? It falls back to a local [Ollama](https://ollama.com) model (slower). The world and everything in the video render without any keys.

<details>
<summary><b>Under the hood</b></summary>

- **World:** React Three Fiber + three.js, procedural terrain with hills and lakes, sky and lighting presets (`src/world`)
- **World state:** `world.json`, pushed live to the page over Vite's websocket, with undo history (`pipeline/world.ts`)
- **Agent:** OpenAI-compatible tool calling (Groq by default) with zod-validated tools, scene context, landmarks and automatic model fallback when rate limited (`pipeline/agent`)
- **Behaviors:** `Fly`, `Drive`, `Swim`, `Wander`, `Float`, `Spin`, `Sway`, plus bone effects (`FlapBones`, `WiggleBones`, `SpinNodes`) and `Scatter` for groups (`src/engine`)
- **Asset pipeline:** library search, optional text/image-to-3D generation with auto-rigging, glTF optimization, metadata (bones, clips, size) for smart follow-ups (`pipeline/`)
- **Live activity panel:** every step streams to the page as it happens
- **Demo recording:** `scripts/record-demo.ts` types prompts into the real app in a headless browser and fast-forwards the waiting
- **Tests:** `npm test`

</details>

## Credits

3D models in the demo world are from [Sketchfab](https://sketchfab.com) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/):

- [Castle](https://sketchfab.com/3d-models/castle-d9e2a603c73a492b8a5619ba1f790e06) by VitSh
- [Dragon flying](https://sketchfab.com/3d-models/dragon-flying-78f809b98bbe426e94d4024dc894b206) by NORBERTO-3D
- [Hell Wolf](https://sketchfab.com/3d-models/hell-wolf-551f8788eb3f4b09b644ddf9b6f76db8) by Fubbi
- [Low-poly Man](https://sketchfab.com/3d-models/low-poly-man-7b93db2d46d847f191cf5e841b322856) by Razvan Savescu
- [Pine tree](https://sketchfab.com/3d-models/pine-tree-e52769d653cd4e52a4acff3041961e65) by Andriy Shekh
- [Low Poly Small car](https://sketchfab.com/3d-models/low-poly-small-car-ebe7c5e98a7448b5abb2eaf0cb22b766) by scailman
- [Stylized lowpoly rock](https://sketchfab.com/3d-models/stylized-lowpoly-rock-6e476441b5614231bf4e8de194c418d9) by Bull studios
- [Fox](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox) by PixelMannen (CC0) and tomkranis (CC BY 4.0), via the Khronos glTF sample assets
