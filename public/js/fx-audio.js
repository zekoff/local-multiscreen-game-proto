// Shared fx -> audio router. The server broadcasts a transient `fx` stream on
// every state (laser, explosion, impact, gate, warp, sensorPulse,
// sensorContact); each device plays only the effects that belong to it (music
// is main-screen-only; the laser is heard at weapons; sensor pings at
// engineering; gate chimes at helm; ship-wide booms at the main screen). Pass
// the set of kinds this page owns — everything else is ignored here.
// Ready-room ambient: start a soft lobby bed while phase === 'lobby', stop it
// otherwise. Idempotent (safe to call every snapshot). Consoles call this in
// their render so the bridge has atmosphere while the crew waits to launch.
// `drone` = the low continuous bed. The MAIN SCREEN passes drone:false: it's the
// device actually plugged into speakers in the room, and a constant hum sitting
// under the whole pre-launch conversation wears on people. The sparse beeps stay
// (they read as a ship idling, not as noise), and the consoles — phones, quiet,
// usually pocketed — keep the full bed.
export function readyRoomAmbient(audio, phase, { drone = true } = {}) {
  if (!audio) return;
  if (phase === 'lobby') {
    if (drone) audio.startAmbient?.();
    else audio.stopAmbient?.();
    // Soft, occasional beeps/boops so the bridge feels alive while the crew
    // stands by (called every ~250ms snapshot, so keep the chance low).
    if (Math.random() < 0.02) audio.readyBeep?.();
  } else audio.stopAmbient?.();
}

export function playFxAudio(fx, audio, kinds) {
  if (!fx) return;
  for (const e of fx) {
    if (!kinds.has(e.kind)) continue;
    switch (e.kind) {
      case 'laser': audio.laser(); break;
      case 'explosion': audio.explosion(); break;
      case 'impact': audio.impact(!e.absorbed); break;
      case 'gate': e.passed ? audio.gatePass() : audio.gateMiss(); break;
      case 'warp': audio.warp(); break;
      case 'sensorPulse': audio.sensorPulse(); break;
      case 'sensorContact': audio.sensorContact(); break;
      case 'ionStorm': audio.ionStorm?.(); break; // static wash (engineering + main screen)
      case 'debris': audio.debris?.(); break;     // low gravel rumble (helm + main screen)
      case 'tractorBeam': audio.tractorBeam?.(); break; // tractor latch hum (crew chief)
      case 'stow': audio.stow?.(); break;         // cargo clunk into the hold (crew chief)
      case 'jettison': audio.jettison?.(); break; // cargo whoosh out (crew chief)
      case 'fire': audio.fireAlarm?.(); break;    // shipboard fire alarm (crew chief)
      case 'boarders': audio.boardersAlarm?.(); break; // boarders alarm (crew chief)
      case 'flare': audio.flare?.(); break;       // solar flare surge (ship-wide / main screen)
    }
  }
}
