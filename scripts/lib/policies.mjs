// Bot crew policies, shared by the WebSocket smoke tests (scripts/lib/crew.mjs)
// and the in-process mission lab (scripts/mission-lab.ts). A policy maps the
// latest serialized game state to a list of station actions — exactly what a
// human at that station would send over the wire.
//
// Profiles:
//   skilled - plays each station competently (the smoke-test baseline)
//   novice  - reacts slowly and sloppily; used to probe the difficulty floor
// (A third baseline, unmanned auto-assist, needs no policy: just don't join
// the seats and the engine's auto-crew takes over.)

export function makeCrew(profile = 'skilled', rng = Math.random) {
  // Profile knobs: reaction probability per tick, how much course drift is
  // tolerated before correcting, and how much charge is hoarded before firing.
  const knobs = profile === 'novice'
    ? { react: 0.35, alignTolerance: 30, fireAtCharge: 90, throttle: 85 }
    : { react: 1.0, alignTolerance: 10, fireAtCharge: 0, throttle: 100 };

  // Sticky per-crew state (mirrors what a human remembers between glances).
  let shieldsRequested = false;

  return {
    helm(state) {
      if (state.phase !== 'active' || rng() > knobs.react) return [];
      const actions = [];
      if (state.throttle < knobs.throttle) actions.push({ kind: 'throttle', value: knobs.throttle });
      if (Math.abs(state.alignment) > knobs.alignTolerance) {
        actions.push({ kind: 'nudge', dir: state.alignment > 0 ? -1 : 1 });
      }
      return actions;
    },

    engineering(state) {
      if (state.phase !== 'active' || rng() > knobs.react) return [];
      const actions = [];
      for (const sys of ['engines', 'shields', 'weapons']) {
        if (state.breakers[sys]) actions.push({ kind: 'resetBreaker', system: sys });
      }
      return actions;
    },

    weapons(state) {
      if (state.phase !== 'active') return [];
      const actions = [];
      // Raising shields is a one-time decision even a novice makes eventually.
      if (!state.shields.raised && !shieldsRequested && rng() <= knobs.react) {
        shieldsRequested = true;
        actions.push({ kind: 'shields', raised: true });
      }
      if (rng() > knobs.react) return actions;
      if (state.asteroids.length > 0) {
        const urgent = [...state.asteroids].sort((a, b) => a.impactIn - b.impactIn)[0];
        if (state.targetId !== urgent.id) actions.push({ kind: 'target', id: urgent.id });
        const chargeGate = Math.max(state.fireCost, knobs.fireAtCharge);
        if (state.charge >= chargeGate && state.targetId !== null) actions.push({ kind: 'fire' });
      }
      return actions;
    },
  };
}
