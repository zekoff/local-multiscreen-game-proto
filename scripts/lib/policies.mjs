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
      // approach); otherwise cruise at the profile's travel throttle. A
      // debris field overrides everything: running hot in one scours the
      // hull, so drop under the safe threshold until it clears.
      let wantThrottle = seekGate ? 55 : knobs.throttle;
      if ((state.debrisIn || 0) > 0) wantThrottle = Math.min(wantThrottle, 35);
      if (Math.abs(state.throttle - wantThrottle) > 5) actions.push({ kind: 'throttle', value: wantThrottle });
      if (Math.abs(state.alignment - targetAlign) > knobs.alignTolerance) {
        actions.push({ kind: 'nudge', dir: state.alignment > targetAlign ? -1 : 1 });
      }
      return actions;
    },

    engineering(state) {
      if (state.phase !== 'active' || rng() > knobs.react) return [];
      // Four systems now — tractor folded back into WEAPONS power (shared emitter).
      const sys = ['engines', 'shields', 'weapons', 'sensors'];
      const actions = [];
      // Clear tripped breakers first — a tripped system runs at half power.
      for (const s of sys) {
        if (state.breakers[s]) actions.push({ kind: 'resetBreaker', system: s });
      }
      // Ion storm halves sensor range: burn the pulse to punch through if
      // it's charged (the intended engineering counter-play).
      if ((state.ionStormIn || 0) > 0 && state.sensorPulseReadyIn <= 0) {
        actions.push({ kind: 'sensorPulse' });
      }
      // Threat-aware power triage over the 7-point pool: shift toward weapons in
      // combat OR while towing (the tractor draws weapons power now), else keep
      // engines fed. Novice barely re-triages (sticks near the default split).
      const nearest = state.asteroids.length
        ? Math.min(...state.asteroids.map((a) => a.impactIn))
        : Infinity;
      const combat = nearest <= 14;
      const towing = !!(state.tractor && state.tractor.latched);
      const target = profile === 'novice'
        ? { engines: 3, weapons: 2, shields: 1, sensors: 1 }
        : (combat || towing)
          ? { engines: 2, weapons: 3, shields: 1, sensors: 1 }
          : { engines: 3, weapons: 2, shields: 1, sensors: 1 };
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
      // Shields react only to inbound ROCKS (pods/minerals aren't threats).
      const rocks = state.asteroids.filter((a) => a.kind === 'rock' || a.kind === 'unknown');
      const nearest = rocks.length > 0 ? Math.min(...rocks.map((a) => a.impactIn)) : Infinity;
      const wantShields = state.shields.raised ? nearest <= 14 : nearest <= 10;
      if (wantShields !== state.shields.raised && rng() <= knobs.react) {
        actions.push({ kind: 'shields', raised: wantShields });
      }
      if (rng() > knobs.react) return actions;

      const t = state.tractor || {};
      // Don't-shoot discipline: NEVER target a pod/mineral/ghost. The urgent
      // detected non-pod contact is the shoot candidate.
      const acquirable = state.asteroids.filter((a) => a.targetable && a.kind !== 'pod' && a.kind !== 'mineral' && a.kind !== 'ghost');
      const urgentRock = acquirable.length ? [...acquirable].sort((a, b) => a.impactIn - b.impactIn)[0] : null;
      const rockThreat = !!urgentRock && urgentRock.impactIn <= 12;

      // Tow: the tractor shares this emitter now. When nothing urgent needs the
      // laser, latch an identified pod/mineral inside the arc; drop the latch the
      // moment a rock closes (the emitter can't do both).
      const holdFree = (state.cargo ? state.cargo.length : 0) < (state.holdCapacity || 4);
      if (t.latched) {
        if (rockThreat) actions.push({ kind: 'tractorLatch', on: false });
      } else if (!rockThreat && holdFree && (t.power || 0) >= 1) {
        const cand = (state.asteroids || []).find((a) => a.tractorable && Math.abs(state.alignment - a.bearing) <= 55);
        if (cand) {
          if (t.targetId !== cand.id) actions.push({ kind: 'tractorTarget', id: cand.id });
          else actions.push({ kind: 'tractorLatch', on: true });
        }
      }

      // Fire only when the emitter is free (not latched) and there's a CONFIRMED
      // rock locked — holds fire on UNKNOWN blips (confirm before shooting).
      if (!t.latched && urgentRock) {
        if (state.targetId !== urgentRock.id) actions.push({ kind: 'target', id: urgentRock.id });
        const tgt = state.asteroids.find((a) => a.id === state.targetId);
        const confirmedRock = tgt && tgt.kind === 'rock';
        // Governor (skilled only): snapshot a small, close rock to clear it fast.
        if (profile !== 'novice' && tgt && confirmedRock && tgt.size <= 1.0 && tgt.impactIn < 7) {
          if (state.governor !== 'snapshot') actions.push({ kind: 'governor', mode: 'snapshot' });
        } else if (state.governor === 'snapshot') {
          actions.push({ kind: 'governor', mode: 'standard' });
        }
        const needed = state.governor === 'snapshot' ? 40 : 100;
        if (state.charge >= needed && confirmedRock) actions.push({ kind: 'fire' });
      }
      return actions;
    },

    // Crew Chief: damage control only now (the tow moved to the weapons emitter).
    // Skilled works every tick (react 1.0); novice is slow (react 0.35).
    crewchief(state) {
      if (state.phase !== 'active' || rng() > knobs.react) return [];
      const actions = [];
      // Damage control: put a free hand on an unattended emergency.
      const emg = state.emergencies || [];
      const free = state.crew ? state.crew.free : 0;
      const unmanned = emg.find((e) => e.assigned === 0);
      if (unmanned && free > 0) actions.push({ kind: 'assignCrew', id: unmanned.id, delta: 1 });
      else if (free > 0 && emg.length > 0) actions.push({ kind: 'assignCrew', id: emg[0].id, delta: 1 });
      return actions;
    },
  };
}
