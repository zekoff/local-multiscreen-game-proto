// One-off verification against the LIVE Cloudflare deployment (not wrangler
// dev): checks the cloud-migration.md acceptance criteria that can be
// checked headlessly. Not part of the regular test suite — delete after use
// or keep as a manual `node scripts/verify-cloud.mjs` check.

import { runBotCrew } from './lib/crew.mjs';

const BASE = process.env.CLOUD_URL || 'https://bridge-crew.zekoff.workers.dev';

async function main() {
  console.log(`Target: ${BASE}\n`);

  // 1. TLS + healthz
  console.log('[1] /healthz over TLS...');
  const health = await fetch(`${BASE}/healthz`);
  if (!health.ok) throw new Error(`healthz HTTP ${health.status}`);
  console.log(`    OK (${health.status}), protocol=${new URL(BASE).protocol}`);

  // 2. room-info returns an https join URL derived from Host (not a LAN IP)
  console.log('[2] room-info join URL...');
  const roomRes = await fetch(`${BASE}/api/rooms`, { method: 'POST' });
  const { code } = await roomRes.json();
  const infoRes = await fetch(`${BASE}/api/room-info?code=${code}`);
  const info = await infoRes.json();
  console.log(`    room ${code} joinUrl=${info.joinUrl}`);
  if (!info.joinUrl?.startsWith('https://')) throw new Error(`joinUrl not https: ${info.joinUrl}`);
  // QR is generated client-side (public/js/vendor/qrcode-generator.mjs) from
  // this joinUrl, not returned by the API — nothing further to check here.

  // 3. Two simultaneous games, run concurrently, verify no cross-interference
  console.log('[3] two simultaneous rooms (concurrent missions)...');
  // The live deployment runs at real-time speed (no GAME_SPEED override),
  // unlike the smoke tests' 10x — missions take several real minutes.
  const [d1, d2] = await Promise.all([
    runBotCrew(BASE, { missionId: 'gen:europa', timeoutMs: 10 * 60_000 }),
    runBotCrew(BASE, { missionId: 'first-flight', timeoutMs: 10 * 60_000 }),
  ]);
  console.log(`    room A: ${d1.missionId} seed=${d1.seed} -> ${d1.outcome} (${d1.score})`);
  console.log(`    room B: ${d2.missionId} seed=${d2.seed} -> ${d2.outcome} (${d2.score})`);
  if (!d1.missionId.startsWith('gen:europa') || d2.missionId !== 'first-flight') {
    throw new Error('mission cross-talk between concurrent rooms');
  }

  console.log('\nVERIFY-CLOUD PASS');
}

main().catch((e) => {
  console.error(`VERIFY-CLOUD FAIL: ${e.message}`);
  process.exit(1);
});
