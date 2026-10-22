// Where things are in the level (1 unit = 1 meter).
// The player starts at the spawn point and faces "forward" (toward -Z),
// down the corridor to the fog gate, with the boss arena beyond it.
//
//   z = +8   back wall of the courtyard
//   z =  0   SPAWN (knight) + Site of Grace
//   z = -6   courtyard narrows into the corridor
//   z = -26  fog gate, set into the colosseum wall
//   z = -26 to -33   stone bridge over the chasm
//   z = -52  center of the round arena platform
//   z = -110 the tower, looming in the mist behind the colosseum
//
// Seen from above, the arena is rings around its center:
//   0–19 m   the raised stone platform you fight on
//   19–26 m  the chasm (only the bridge crosses it)
//   26–30 m  the colosseum: two tiers of arches with a gallery behind
//   30–40 m  stepped stands on the left and right

export const SPAWN = { x: 0, z: 0, facing: Math.PI };
export const GRACE = { x: 1.8, z: -0.8 };
export const COURTYARD = { halfWidth: 7.5, back: 8.5, front: -6.5 };
export const CORRIDOR = { halfWidth: 5 };
export const GATE_Z = -26;
export const ARENA = { z: -52, platform: 19, chasm: 26, gallery: 30, stands: 40, chasmDepth: 16 };
export const BRIDGE = { halfWidth: 2.5 };
export const TOWER_Z = -110;
