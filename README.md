<div align="center">

# NeuroCraft

### Describe a world. Watch it appear.

A living 3D world you shape by typing. Ask for a castle, a dragon, a sunset: it shows up in seconds, already lit, animated and moving.

<img src="docs/media/demo.gif" alt="Typing 'a castle on that hill in the distance' makes a castle appear; then a dragon circles it; then the world turns to golden sunset" width="100%" />

<sub>Real, unedited flow, with only the waiting fast-forwarded. <a href="docs/media/demo.mp4">Watch the full-quality video</a>.</sub>

</div>

---

## The idea

Building 3D worlds normally means modeling, rigging, texturing, animating and scripting. NeuroCraft hides all of that behind a single text bar.

You say what you want. The AI works out the rest: it finds or creates the model, gives it a skeleton if it should move, scales it to real-world size, places it where it makes sense and brings it to life. Then you keep talking:

> **"a castle on that hill in the distance"**: a stone castle rises on the far hill
>
> **"make the red dragon circle above the castle"**: the dragon changes course and banks around the towers
>
> **"turn it into a golden sunset"**: the sun drops, the light warms, shadows stretch across the valley

No menus, no asset stores, no editors. Just intent.

## What you can do

| | |
|---|---|
| **Create anything** | Characters, creatures, vehicles, buildings, props, plants: *"a pine forest over there"*, *"a knight"*, *"a red sports car"* |
| **Change anything** | *"make it bigger"*, *"paint it blue"*, *"five more of those"*, *"delete a man"* |
| **Make it move** | *"make it fly"*, *"make the men run in a circle"*, *"drive around the lake"*, *"wander around"* |
| **Set the mood** | *"golden sunset"*, *"make it night"* |
| **Point instead of describing** | Double-click a spot for *"here"*, double-click an object for *"it"* |

While it works, a live panel shows each step as it happens: what it's looking for, what it chose, what changed. Then it steps aside and shows you history.

## How it feels magical (and what's really happening)

Every request becomes a small chain of real work. You don't need to know about any of it:

1. **Understand**: turn the sentence into an intent: what object, where, how it should behave.
2. **Find or create**: pull a matching model from a large 3D library, or generate a brand-new textured model from the words (or from an image).
3. **Bring it to life**: if it's a creature or character, give it a skeleton and motions (walk, run, idle…). Flying, swimming and driving are procedural, so anything can do them.
4. **Place it**: size it to real-world scale, set it on the terrain, frame the camera on it.
5. **Keep it editable**: every object is a tiny piece of code, so follow-ups like *"make it fly"* are instant edits, not re-generations.

## Run it

```bash
git clone https://github.com/duc-minh-droid/neurocraft
cd neurocraft
npm install
npm run dev          # open http://localhost:5173
```

The world, the objects in the video, and the interaction layer all work out of the box. To add new objects from text you'll need API keys for model search and generation in `.env` (see `.env.example`), plus an AI agent connected to the text bar. See [AGENTS.md](AGENTS.md) for the agent workflow.

<details>
<summary><b>Under the hood</b></summary>

- **World:** React Three Fiber + three.js, procedural terrain, lakes, sky and lighting presets
- **Objects:** each lives in `src/entities/<name>.tsx`. Behaviors like `Fly`, `Drive`, `Wander`, `Swim`, `FlapBones`, `SpinNodes` and `Scatter` compose like building blocks
- **Asset pipeline** (`pipeline/`): library search, text/image-to-3D generation, auto-rigging and animation retargeting, glTF optimization, metadata (bones, clips, size) for smart follow-ups
- **Live activity:** the pipeline streams step events to the page over Vite's websocket
- **Text bar:** messages are relayed to the AI agent, which does the work and narrates it back
- **Demo recording:** `scripts/record-demo.ts` records the real flow in a headless browser and fast-forwards the waiting

</details>

## Credits

3D models used in the demo world are from [Sketchfab](https://sketchfab.com) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/):

- [Low Poly Castle](https://sketchfab.com/3d-models/low-poly-castle-827e3eae661c48419d2616e2d7739952) by treymill33
- [Dragon flying](https://sketchfab.com/3d-models/dragon-flying-78f809b98bbe426e94d4024dc894b206) by NORBERTO-3D
- [Low-poly Man](https://sketchfab.com/3d-models/low-poly-man-7b93db2d46d847f191cf5e841b322856) by Razvan Savescu
- [Pine tree](https://sketchfab.com/3d-models/pine-tree-e52769d653cd4e52a4acff3041961e65) by Andriy Shekh
- [Low Poly Small car](https://sketchfab.com/3d-models/low-poly-small-car-ebe7c5e98a7448b5abb2eaf0cb22b766) by scailman
- [Stylized lowpoly rock](https://sketchfab.com/3d-models/stylized-lowpoly-rock-6e476441b5614231bf4e8de194c418d9) by Bull studios
- [Fox](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox) by PixelMannen (CC0) and tomkranis (CC BY 4.0), via the Khronos glTF sample assets
