# Character animations (Mixamo packs)

The knight's animations come from Mixamo's free **Sword and Shield Pack**, and the boss's from the
**Great Sword Pack**. Mixamo packs are made for its stand-in character "Y Bot", so a script copies
each animation from Y Bot's skeleton onto our characters' own skeletons ("retargeting").
Both characters use the same skeleton layout, so the same script works for both.

## What's where

| File / folder                     | What it is                                                        |
|-----------------------------------|-------------------------------------------------------------------|
| `mixamo/Knight/`, `mixamo/BOSS/`  | The unzipped packs (all the `.fbx` files + `Y Bot.fbx`)           |
| `mixamo/*/rename.json`            | Clearer names for clips like "walk (2)" (which way they move)     |
| `mixamo/Knight/mirror.json`       | Clips to also make a left/right-mirrored copy of (the knight drinks with the left hand) |
| `mixamo/Knight_reference.glb`, `mixamo/BOSS_reference.glb` | Each character with its skeleton and full-quality materials. Don't delete. |
| `public/models/Knight.glb`, `public/models/BOSS.glb` | The finished animated characters the game loads |
| `Knight_sword.glb`, `Knight_shield.glb`, `BOSS_sword.glb` | Weapons (the game uses the shrunk copies in `public/models/`) |
| `tools/retarget_mixamo.py`        | The Blender script that copies the animations over                |
| `tools/make_shield.py`            | The Blender script that built the shield                          |

## Re-building the animated characters

Open a terminal in the project folder and type:

```
npm.cmd run animations
npm.cmd run animations:boss
```

(Use `npm.cmd`, not `npm`. Plain `npm` gives a red "running scripts is disabled" error in PowerShell.)

It takes about a minute. Then refresh the game page.

## Adding more animations

1. On mixamo.com, download another animation (or a whole pack) **for Y Bot**,
   as **FBX Binary**, **30 FPS**. "With Skin" or "Without Skin" both work.
2. Put the `.fbx` files in `mixamo/Knight/` or `mixamo/BOSS/` (next to `Y Bot.fbx`).
3. Run `npm.cmd run animations` (or `animations:boss`) again.

Want a clip done with the other hand? Add it to that pack's `mirror.json`, e.g.
`{ "drinking": "drinking_left" }` makes a mirrored copy called `drinking_left`.

Not sure which way a clip moves? Run the Blender script with `--report` and it lists how far
each clip travels forward and sideways; put clearer names in that pack's `rename.json`.

Each file becomes an animation named after it, with "sword and shield " removed
and "(2)" turned into "_2": `sword and shield slash (2).fbx` becomes `slash_2`.

## Animations in the game right now (51)

- **Moving:** `idle`, `idle_2`–`idle_4`, `walk`, `walk_back`, `run`, `run_back`,
  `strafe_left`, `strafe_right`, `strafe_left_run`, `strafe_right_run`, `turn`, `turn_2`, `180_turn`, `180_turn_2`, `jump`, `jump_2`
- **Fighting:** `attack`, `attack_2`–`attack_4`, `slash`, `slash_2`–`slash_5`, `kick`,
  `block`, `block_2`, `block_idle`, `crouch_block…`, `impact`, `impact_2`, `impact_3`, `death`, `death_2`
- **Other:** `draw_sword_1/2`, `sheath_sword_1/2`, `casting`, `casting_2`, `power_up`, `crouch…`

Right now the game uses `idle`, `walk` and `run`. The rest are ready for attacks, blocking,
getting hit and dying.

## Replacing the shield

To use your own shield, save it as `Knight_shield.glb` with the **front facing forward (+Z)**,
**top pointing up (+Y)**, and the **origin where the forearm straps on**. Then shrink it:

```
npx.cmd gltf-transform optimize Knight_shield.glb public/models/Knight_shield.glb --texture-compress webp --texture-size 1024 --compress meshopt
```
