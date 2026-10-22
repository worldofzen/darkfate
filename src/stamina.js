// Stamina, Elden Ring style:
//   - Attacks, dodges, running and blocking hits all cost stamina.
//   - You can start an action as long as you have ANY stamina left, even if it costs more
//     than you have (the bar just drops to zero).
//   - After you spend some, there's a short pause, then it refills quickly.
//   - It refills much slower while you hold your shield up.
export const STAMINA = {
  max: 100,
  refillPerSecond: 45,
  refillDelay: 0.9, // seconds of rest before refilling starts
  blockingRefill: 0.35, // refill speed while blocking (35% of normal)

  attack: 18,
  dodge: 20,
  backstep: 12,
  runPerSecond: 14,
  blockPerDamage: 0.8, // a blocked hit costs this much stamina for each point of damage
  runAgainAt: 0.3, // after running out while running, you can't run again until 30% is back
};

export function createStamina() {
  let value = STAMINA.max;
  let delay = 0;
  let onEmptyTry = () => {};

  return {
    get value() {
      return value;
    },
    get fraction() {
      return value / STAMINA.max;
    },

    // Try to pay for an action. Fails only when the bar is completely empty.
    spend(amount) {
      if (value <= 0) {
        onEmptyTry();
        return false;
      }
      value = Math.max(0, value - amount);
      delay = STAMINA.refillDelay;
      return true;
    },

    // Back to full (when you respawn).
    reset() {
      value = STAMINA.max;
      delay = 0;
    },

    // Called when you try to do something with an empty bar (the HUD flashes).
    onEmpty(callback) {
      onEmptyTry = callback;
    },

    update(dt, { blocking = false } = {}) {
      if (delay > 0) {
        delay -= dt;
        return;
      }
      const rate = STAMINA.refillPerSecond * (blocking ? STAMINA.blockingRefill : 1);
      value = Math.min(STAMINA.max, value + rate * dt);
    },
  };
}
