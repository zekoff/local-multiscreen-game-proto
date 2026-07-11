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
      for (const sys of ['engines', 'shields', 'weapons', 'sensors']) {
        if (state.breakers[sys]) actions.push({ kind: 'resetBreaker', system: sys });
      }
      // Re-power the ship if points are unallocated (e.g. after an Emergency
      // Warp): fill toward a sensible default split.
      const target = { engines: 2, weapons: 2, shields: 1, sensors: 1 };
      const used = ['engines', 'shields', 'weapons', 'sensors'].reduce((n, s) => n + (state.power[s] || 0), 0);
      if (used < 6) {
        for (const s of ['engines', 'weapons', 'shields', 'sensors']) {
          if ((state.power[s] || 0) < target[s]) { actions.push({ kind: 'power', system: s, delta: 1 }); break; }
        }
      }
      return actions;
    },

    weapons(state) {
      if (state.phase !== 'active') return [];
      const actions = [];
      // Shields react to ANY inbound rock (even one sensors haven't resolved);
      // hysteresis avoids flip-flopping, act only on a change of intent.
      const nearest = state.asteroids.length > 0
        ? Math.min(...state.asteroids.map((a) => a.impactIn))
        : Infinity;
      const wantShields = state.shields.raised ? nearest <= 14 : nearest <= 10;
      if (wantShields !== state.shields.raised && rng() <= knobs.react) {
        actions.push({ kind: 'shields', raised: wantShields });
      }
      if (rng() > knobs.react) return actions;
      // Firing needs a sensor-resolved (targetable) contact and a full recharge.
      const acquirable = state.asteroids.filter((a) => a.targetable);
      if (acquirable.length > 0) {
        const urgent = [...acquirable].sort((a, b) => a.impactIn - b.impactIn)[0];
        if (state.targetId !== urgent.id) actions.push({ kind: 'target', id: urgent.id });
        if (state.charge >= 100 && state.targetId !== null) actions.push({ kind: 'fire' });
      }
      return actions;
    },
  };
}
