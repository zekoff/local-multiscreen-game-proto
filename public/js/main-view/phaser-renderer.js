// Phaser 4 space-view renderer (WIP scaffold). Implements the renderer.js
// contract so the shell can mount it in place of the Canvas 2D renderer for a
// live apples-to-apples comparison. This scaffold proves the plumbing end to
// end — Phaser boots full-bleed into the #viewscreen container, banks with the
// interpolated alignment, streams a starfield, and reads the shared model — so
// the switch and the shared HUD overlay can be verified now. Step 4 builds the
// full scene (CC0 sprites for station/asteroids, gates, lasers, explosions, and
// the C-fx feedback with Bloom/Glow/particles) on top of this same skeleton.
//
// Reads the shared model.js (snapshot + interpolators) and effects.js (fx
// buffers + scalars); calls effects.advance(dt) once per frame — the single
// source of truth for effect timing shared with the canvas renderer.

import Phaser from '/js/vendor/phaser.esm.min.js';
import { getLatest, displayAlignment } from '/js/main-view/model.js';
import { fx, advance } from '/js/main-view/effects.js';

const STAR_COUNT = 150;
const STAR_FAR_Z = 1;
const STAR_NEAR_Z = 0.02;

class SpaceScene extends Phaser.Scene {
  constructor() {
    super('space');
    this.yaw = 0;
    this.lastTs = 0;
  }

  create() {
    this.cameras.main.setBackgroundColor('#05070d');
    this.starGfx = this.add.graphics();
    // Star field in normalized perspective coords (same math as the canvas
    // renderer) so the sense of speed reads identically.
    this.stars = Array.from({ length: STAR_COUNT }, () => this.resetStar({}, true));
    // WIP marker so it's obvious which renderer is live during comparison.
    this.tag = this.add.text(0, 0, 'PHASER RENDERER · WIP', {
      fontFamily: 'monospace', fontSize: '13px', color: 'rgba(125,219,154,0.5)',
    }).setResolution(Math.min(3, window.devicePixelRatio || 1));
    this.scale.on('resize', this.layout, this);
    this.layout();
  }

  layout() {
    const { width, height } = this.scale;
    if (this.tag) this.tag.setPosition(12, height - 26);
  }

  resetStar(s, seed) {
    s.x = (Math.random() - 0.5) * 2.4;
    s.y = (Math.random() - 0.5) * 2.4;
    s.z = seed ? STAR_NEAR_Z + Math.random() * (STAR_FAR_Z - STAR_NEAR_Z) : STAR_FAR_Z;
    return s;
  }

  update(time) {
    const dt = this.lastTs ? Math.min(0.05, (time - this.lastTs) / 1000) : 0;
    this.lastTs = time;
    advance(dt); // age shared fx buffers/scalars once per frame

    const latest = getLatest();
    const active = !!(latest && latest.phase === 'active');
    const { width: w, height: h } = this.scale;

    // Bank the camera with the interpolated alignment (matches the canvas view).
    const targetYaw = active ? Math.max(-1, Math.min(1, displayAlignment() / 100)) : 0;
    this.yaw += (targetYaw - this.yaw) * Math.min(1, dt * 8);
    this.cameras.main.setRotation(this.yaw * 0.04);
    // Screen shake driven by the shared scalar (decayed in advance()).
    if (fx.shake > 0.2) {
      const s = fx.shake * 0.25;
      this.cameras.main.setScroll((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    } else {
      this.cameras.main.setScroll(0, 0);
    }

    const cx = w / 2 - this.yaw * w * 0.16;
    const cy = h / 2;
    const projScale = Math.min(w, h) * 0.5;
    const shipSpeed = active ? latest.speed : 5;
    const slipstream = !!(active && latest.slipstream);

    const g = this.starGfx;
    g.clear();
    for (const s of this.stars) {
      s.z -= (0.07 + shipSpeed * 0.0055) * (slipstream ? 2.4 : 1) * dt;
      if (s.z <= STAR_NEAR_Z) this.resetStar(s, false);
      const px = cx + (s.x / s.z) * projScale;
      const py = cy + (s.y / s.z) * projScale;
      if (px < 0 || px > w || py < 0 || py > h) continue;
      const closeness = 1 - (s.z - STAR_NEAR_Z) / (STAR_FAR_Z - STAR_NEAR_Z);
      const size = 0.5 + closeness * 2.5;
      g.fillStyle(0xcfe0ff, 0.2 + closeness * 0.7);
      g.fillRect(px, py, size, size);
    }
  }
}

export function createPhaserRenderer({ container }) {
  let game = null;
  return {
    mount() {
      if (game) return;
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: container,
        // Full-bleed: track the container size instead of a fixed logical scene.
        scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER },
        // A TV/laptop main screen, not a phone — prefer the discrete GPU and 60fps.
        powerPreference: 'high-performance',
        fps: { target: 60 },
        banner: false,
        scene: SpaceScene,
        callbacks: {
          // Tag the canvas so it stacks under the shared HUD overlay (see CSS).
          postBoot: (gm) => { if (gm.canvas) gm.canvas.classList.add('phaser-canvas'); },
        },
      });
      // Pause rendering while the tab is hidden (battery + no drift on a snapshot
      // the scene isn't seeing).
      document.addEventListener('visibilitychange', this._vis = () => {
        if (!game) return;
        if (document.hidden) game.loop.sleep(); else game.loop.wake();
      });
    },
    resize() { game?.scale.refresh(); },
    destroy() {
      if (this._vis) document.removeEventListener('visibilitychange', this._vis);
      game?.destroy(true);
      game = null;
    },
  };
}
