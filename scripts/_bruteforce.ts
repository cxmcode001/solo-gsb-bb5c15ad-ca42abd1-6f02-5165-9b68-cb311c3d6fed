import { generatePairing } from '/workspace/src/engine';
import type { Player, Round } from '/workspace/src/types';

function bruteCheck(
  ps: Player[],
  rounds: Round[],
  manual: { id: string; aId: string; bId: string; locked: boolean }[],
): {
  best: { same: number; cross: number; diff: number } | null;
  plan: ReturnType<typeof generatePairing>;
} | null {
  const lockAdj = new Map<string, string>();
  const lockEdges: [string, string][] = [];
  for (const m of manual) {
    lockAdj.set(m.aId, m.bId);
    lockAdj.set(m.bId, m.aId);
    lockEdges.push([m.aId, m.bId]);
  }
  function* lockedEntries(): Generator<[string, string]> {
    for (const e of lockEdges) yield e;
  }
  const played = new Set<string>();
  for (const r of rounds)
    for (const m of r.matches)
      if (m.playerBId)
        played.add(
          m.playerAId < m.playerBId ? `${m.playerAId}|${m.playerBId}` : `${m.playerBId}|${m.playerAId}`,
        );
  for (const [a, b] of lockedEntries()) {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (played.has(k)) return null;
  }
  const standings = new Map<string, number>();
  for (const p of ps) standings.set(p.id, 0);
  for (const r of rounds)
    for (const m of r.matches) {
      if (!m.playerBId) {
        standings.set(m.playerAId, (standings.get(m.playerAId) ?? 0) + 2);
        continue;
      }
      if (m.resultA === 'win') standings.set(m.playerAId, (standings.get(m.playerAId) ?? 0) + 2);
      else if (m.resultA === 'draw') {
        standings.set(m.playerAId, (standings.get(m.playerAId) ?? 0) + 1);
        standings.set(m.playerBId, (standings.get(m.playerBId) ?? 0) + 1);
      } else if (m.resultA === 'loss') {
        standings.set(m.playerBId, (standings.get(m.playerBId) ?? 0) + 2);
      }
    }
  const teamOf = (id: string) => {
    const t = ps.find((p) => p.id === id)?.team?.trim();
    return t || null;
  };
  const lockedIds = new Set(lockAdj.keys());
  const plan = generatePairing({ players: ps, rounds, manual });
  let freeIds = ps.filter((p) => !lockedIds.has(p.id)).map((p) => p.id);
  // 引擎在奇数人时安排轮空：只比较成对局指标，奇数人去掉引擎所选轮空者后再枚举
  if (freeIds.length % 2 === 1) freeIds = freeIds.filter((id) => id !== plan.byeId);

  let best: { same: number; cross: number; diff: number } | null = null;
  const rec = (rem: string[], edges: [string, string][]) => {
    if (!rem.length) {
      let same = 0;
      let cross = 0;
      let diff = 0;
      const all: [string, string][] = [...lockedEntries(), ...edges];
      for (const [a, b] of all) {
        const ta = teamOf(a);
        if (ta && ta === teamOf(b)) same++;
        const pa = standings.get(a) ?? 0;
        const pb = standings.get(b) ?? 0;
        if (pa !== pb) cross++;
        diff += Math.abs(pa - pb);
        const k = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (played.has(k)) return;
      }
      if (
        !best ||
        same < best.same ||
        (same === best.same && cross < best.cross) ||
        (same === best.same && cross === best.cross && diff < best.diff)
      )
        best = { same, cross, diff };
      return;
    }
    const a = rem[0];
    for (let i = 1; i < rem.length; i++) {
      rec([...rem.slice(1, i), ...rem.slice(i + 1)], [...edges, [a, rem[i]]]);
    }
  };
  rec(freeIds, []);
  return { best, plan };
}

let seed = 42;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const teamPool = ['红', '蓝', '绿', null];
let checked = 0;
for (let t = 0; t < 500; t++) {
  const n = 2 + Math.floor(rand() * 3) * 2; // 2..6 even
  const ps: Player[] = Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    team: teamPool[Math.floor(rand() * teamPool.length)] ?? '',
  }));
  const rounds: Round[] = [];
  const pool = ps.map((p) => p.id);
  const matches: Round['matches'] = [];
  while (pool.length >= 2 && rand() > 0.3) {
    const ai = Math.floor(rand() * pool.length);
    const a = pool.splice(ai, 1)[0];
    const bi = Math.floor(rand() * pool.length);
    const b = pool.splice(bi, 1)[0];
    const r = rand();
    matches.push({
      id: `m${a}${b}`,
      playerAId: a,
      playerBId: b,
      resultA: r < 0.7 ? 'win' : r < 0.85 ? 'draw' : 'loss',
    });
  }
  if (matches.length) rounds.push({ id: 'r1', matches });

  // 随机加一条锁定
  const manual: { id: string; aId: string; bId: string; locked: boolean }[] = [];
  if (rand() > 0.6 && ps.length >= 4) {
    const a = ps[Math.floor(rand() * ps.length)];
    let b = ps[Math.floor(rand() * ps.length)];
    if (b.id !== a.id) manual.push({ id: `lock${a.id}${b.id}`, aId: a.id, bId: b.id, locked: true });
  }

  const out = bruteCheck(ps, rounds, manual);
  if (!out) continue;
  const { best, plan } = out;
  if (plan.ok && best) {
    checked++;
    if (
      plan.sameTeamCount !== best.same ||
      plan.crossCount !== best.cross ||
      plan.totalDiff2 !== best.diff
    ) {
      console.log('MISMATCH', {
        n,
        teams: ps.map((p) => p.team),
        manual,
        rounds: rounds.map((r) =>
          r.matches.map((m) => `${m.playerAId}(${m.resultA})-${m.playerBId}`),
        ),
        bye: plan.byeId,
        got: [plan.sameTeamCount, plan.crossCount, plan.totalDiff2],
        exp: [best.same, best.cross, best.diff],
      });
      process.exit(1);
    }
  }
}
console.log(`brute-force ${checked} feasible cases OK`);
