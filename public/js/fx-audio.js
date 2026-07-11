// Shared fx -> audio router. The server broadcasts a transient `fx` stream on
// every state (laser, explosion, impact, gate, warp, sensorPulse,
// sensorContact); each device plays only the effects that belong to it (music
// is main-screen-only; the laser is heard at weapons; sensor pings at
// engineering; gate chimes at helm; ship-wide booms at the main screen). Pass
// the set of kinds this page owns — everything else is ignored here.
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
    }
  }
}
