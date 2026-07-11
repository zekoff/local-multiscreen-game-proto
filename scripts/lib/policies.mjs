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

  // A skilled helm commits to a nav gate on final approach (easing the throttle
  // to buy time and swing onto its bearing) for the slipstream reward; the
  // novice's wide tolerance / low reaction means it mostly ignores gates.
  const chaseGates = profile !== 'novice';

  return {
    helm(state) {
      if (state.phase !== 'active' || rng() > knobs.react) return [];
      const actions = [];
      const gate = chaseGates && state.gates && state.gates.length
        ? [...state.gates].sort((a, b) => a.reachIn - b.reachIn)[0]
        : null;
      // Only commit once a gate is close enough to line up on.
      const seekGate = gate && gate.reachIn < 7;
      const targetAlign = seekGate ? gate.bearing : 0;
      // Ease the throttle while swinging onto a gate (turn harder, slow its
      // approach); otherwise cruise at the profile's travel throttle.
      const wantThrottle = seekGate ? 55 : knobs.throttle;
      if (Math.abs(state.throttle - wantThrottle) > 5) actions.push({ kind: 'throttle', value: wantThrottle });
      if (Math.abs(state.alignment - targetAlign) > knobs.alignTolerance) {
        actions.push({ kind: 'nudge', dir: state.alignment > targetAlign ? -1 : 1 });
      }
      return actions;
    },

    engineering(state) {
      if (state.phase !== 'active' || rng() > knobs.react) return [];
      const sys = ['engines', 'shields', 'weapons', 'sensors'];
      const actions = [];
      // Clear tripped breakers first — a tripped system is now fully offline.
      for (const s of sys) {
        if (state.breakers[s]) actions.push({ kind: 'resetBreaker', system: s });
      }
      // Threat-aware power triage: when rocks are inbound, pump weapons + sensors
      // (fast refire + early detection); when the sky is clear, feed the engines
      // to travel. Novice's default split is flatter (it barely re-triages).
      const nearest = state.asteroids.length
        ? Math.min(...state.asteroids.map((a) => a.impactIn))
        : Infinity;
      const combat = nearest <= 20;
      const target = profile === 'novice'
        ? { engines: 2, weapons: 2, shields: 1, sensors: 1 }
        : combat
          ? { engines: 1, weapons: 3, shields: 0, sensors: 2 }
          : { engines: 3, weapons: 1, shields: 1, sensors: 1 };
      // Nudge one point toward the target split: free an over-allocated system,
      // then raise an under-allocated one (net-neutral on the power budget, or a
      // pure fill after an Emergency Warp zeroes everything).
      const over = sys.find((s) => (state.power[s] || 0) > target[s]);
      const under = sys.find((s) => (state.power[s] || 0) < target[s]);
      if (over && (state.power[over] || 0) > 0) actions.push({ kind: 'power', system: over, delta: -1 });
      if (under) actions.push({ kind: 'power', system: under, delta: 1 });
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
