// Where things are in the level (1 unit = 1 meter).
// The player starts at the spawn point and faces "forward" (toward -Z),
// down the corridor to the fog gate, with the boss arena beyond it.
//
//   z = +8   back wall of the courtyard
//   z =  0   SPAWN (knight) + Site of Grace
//   z = -6   courtyard narrows into the corridor
//   z = -26  fog gate (the veil), set into the colosseum wall
//   z = -26 to -49   the walkway (Arena_walkway.glb): a long stone bridge over the chasm
//   z = -66  center of the round arena platform
//   z = -140 the tower, looming in the mist behind the colosseum
//
// Seen from above, the arena is rings around its center:
//   0–19 m   the stone platform you fight on (Arena_center.glb)
//   19–40 m  the chasm (only the walkway crosses it)
//   40 m     the colosseum: a ring of arcaded walls (Dungeon_wall.glb)

export const SPAWN = { x: 0, z: 0, facing: Math.PI / 2 }; // resting at the bonfire, facing it
export const GRACE = { x: 1.45, z: 0 }; // the bonfire, just in front of the spawn point
export const COURTYARD = { halfWidth: 7.5, back: 8.5, front: -6.5 };
export const CORRIDOR = { halfWidth: 5 };
export const GATE_Z = -26;
export const GATE_TOP = 10.8; // top of the gateway (Arena_gate.glb, placed in level.js)
export const ARENA = { z: -66, platform: 19, chasm: 40, gallery: 44, chasmDepth: 16 };
export const BRIDGE = { halfWidth: 1.5 }; // the walkway's deck, between its parapets
export const TOWER_Z = -140;
