import assert from 'node:assert';
import type { DraftPair, Player, Round } from '../src/types';
import {
  buildPlayedMap,
  computeStandings,
  generatePairing,
  pairKey,
  points2Label,
} from '../src/engine';

let uid = 0;
const mkPlayers = (names: string[]): Player[] =>
  names.map((name) => ({ id: `p${++uid}`, name }));

let mid = 0;
const match = (a: string, b: string | null, result: 'win' | 'draw' | 'loss' = 'win') => ({
  id: `m${++mid}`,
  playerAId: a,
  playerBId: b,
  resultA: b === null ? 'win' : result,
  bye: b === null,
});

const round = (matches: Round['matches']): Round => ({ id: `r${++uid}`, matches });

const lock = (a: string, b: string | null): DraftPair => ({
  id: `lock${++uid}`,
  aId: a,
  bId: b,
  locked: true,
});

// 1. 首轮：所有人同分 => 无跨组、总差为 0
{
  const ps = mkPlayers(['A', 'B', 'C', 'D']);
  const plan = generatePairing({ players: ps, rounds: [], manual: [] });
  assert.ok(plan.ok, '首轮应成功');
  assert.strictEqual(plan.crossCount, 0);
  assert.strictEqual(plan.totalDiff2, 0);
  assert.strictEqual(plan.pairs.length, 2);
  assert.strictEqual(plan.byeId, null);
  console.log('✓ 首轮同分配对');
}

// 2. 奇数人数：最低积分且未轮空者轮空
{
  // 第 1 轮：A 胜 B，C 胜 D，E 轮空
  const ps = mkPlayers(['A', 'B', 'C', 'D', 'E']);
  const [A, B, C, D, E] = ps;
  const r1 = round([match(A.id, B.id), match(C.id, D.id), match(E.id, null)]);
  const plan = generatePairing({ players: ps, rounds: [r1], manual: [] });
  assert.ok(plan.ok);
  // B、D 为 0 分且未轮空；E 虽 1 分但已轮空。轮空必须是 B 或 D
  assert.ok(plan.byeId === B.id || plan.byeId === D.id, '应给 0 分未轮空者轮空');
  assert.notStrictEqual(plan.byeId, E.id);
  console.log('✓ 轮空：最低积分且未轮空');
}

// 3. 禁止重复交手 + 最小跨组数
{
  // 6 人：r1 后 A,B,C 为 1 分，D,E,F 为 0 分。r1: A-D, B-E, C-F
  const ps = mkPlayers(['A', 'B', 'C', 'D', 'E', 'F']);
  const [A, B, C, D, E, F] = ps;
  const r1 = round([match(A.id, D.id), match(B.id, E.id), match(C.id, F.id)]);
  const plan = generatePairing({ players: ps, rounds: [r1], manual: [] });
  assert.ok(plan.ok, `应可配对: ${plan.conflicts.map((c) => c.message).join(';')}`);
  // 上半区 3 人（奇）、下半区 3 人（奇），组内完美匹配不可能 => 恰好 1 场跨组
  assert.strictEqual(plan.crossCount, 1, `跨组对局应为 1，实际 ${plan.crossCount}`);
  // 不重复
  const played = buildPlayedMap([r1]);
  for (const p of plan.pairs) {
    assert.ok(!played.has(pairKey(p.aId, p.bId)), '不得重复交手');
  }
  // 跨组对局积分差必须为 2（1 分 vs 0 分）
  const cross = plan.pairs.filter((p) => p.crossGroup);
  assert.strictEqual(cross.length, 1);
  assert.strictEqual(cross[0].diff2, 2);
  console.log('✓ 禁止重复交手 + 跨组数最小');
}

// 4. 锁定对局后重算
{
  const ps = mkPlayers(['A', 'B', 'C', 'D', 'E', 'F']);
  const [A, B, C, D, E, F] = ps;
  const r1 = round([match(A.id, D.id), match(B.id, E.id), match(C.id, F.id)]);
  // 锁定 D vs F（两个 0 分选手组内对局）
  const plan = generatePairing({
    players: ps,
    rounds: [r1],
    manual: [lock(D.id, F.id)],
  });
  assert.ok(plan.ok, plan.conflicts.map((c) => c.message).join(';'));
  const locked = plan.pairs.find((p) => p.locked);
  assert.ok(locked && locked.aId === D.id && locked.bId === F.id, '锁定对局必须保留');
  // 剩下 0 分组只剩 E（奇），上半区 3 人（奇） => 1 场跨组（A/B/C 中一人 vs E）
  assert.strictEqual(plan.crossCount, 1);
  console.log('✓ 锁定人工对局后重算');
}

// 5. 冲突原因：锁定重复交手
{
  const ps = mkPlayers(['A', 'B', 'C', 'D']);
  const [A, B, C, D2] = ps;
  const r1 = round([match(A.id, B.id), match(C.id, D2.id)]);
  const plan = generatePairing({ players: ps, rounds: [r1], manual: [lock(A.id, B.id)] });
  assert.ok(!plan.ok);
  assert.ok(plan.conflicts.some((c) => c.message.includes('重复交手')));
  console.log('✓ 冲突诊断：锁定重复交手');
}

// 6. 冲突原因：无解（三人已两两交手，再次配对必然重复）
{
  const ps = mkPlayers(['A', 'B', 'C']);
  const [A, B, C] = ps;
  // r1: A-B，C 轮空；r2: A-C，B 轮空；r3: B-C，A 轮空
  const r1 = round([match(A.id, B.id), match(C.id, null)]);
  const r2 = round([match(A.id, C.id, 'win'), match(B.id, null)]);
  const r3 = round([match(B.id, C.id, 'win'), match(A.id, null)]);
  const plan = generatePairing({ players: ps, rounds: [r1, r2, r3], manual: [] });
  assert.ok(!plan.ok, '三人已两两交手，第 4 轮预期无解');
  assert.ok(plan.conflicts.length > 0);
  console.log('✓ 冲突诊断：无合法搭档');
}

// 7. 同一选手出现在两条锁定中 => 冲突
{
  const ps = mkPlayers(['A', 'B', 'C', 'D']);
  const [A, B, C] = ps;
  const plan = generatePairing({
    players: ps,
    rounds: [],
    manual: [lock(A.id, B.id), lock(A.id, C.id)],
  });
  assert.ok(!plan.ok);
  assert.ok(plan.conflicts.some((c) => c.message.includes('多条锁定对局')));
  console.log('✓ 冲突诊断：锁定行选手重复');
}

// 8. 积分与和棋
{
  const ps = mkPlayers(['A', 'B', 'C', 'D']);
  const [A, B, C, D] = ps;
  const r1 = round([match(A.id, B.id, 'draw'), match(C.id, D.id)]);
  const standings = computeStandings(ps, [r1]);
  const a = standings.find((s) => s.player.id === A.id)!;
  assert.strictEqual(a.points2, 1);
  assert.strictEqual(points2Label(a.points2), '0.5');
  void C;
  void D;
  console.log('✓ 和棋积分 0.5');
}

// 8b. 字典序优化：先最小化跨组数，再最小化总积分差
{
  // 6 人：
  // r1: A-D、B-E、C-F（A/B/C 胜）=> 积分 A,B,C=1；D,E,F=0
  const ps = mkPlayers(['A', 'B', 'C', 'D', 'E', 'F']);
  const [A, B, C, D, E, F] = ps;
  const r1 = round([
    match(A.id, D.id),
    match(B.id, E.id),
    match(C.id, F.id),
  ]);
  // r2: A 胜 E（跨组），B-C 和，D 胜 F
  // => A=2, B=C=1.5, D=1, E=F=0
  const r2 = round([
    match(A.id, E.id),
    match(B.id, C.id, 'draw'),
    match(D.id, F.id),
  ]);
  // 已交手：A-D,A-E,B-E,B-C,C-F,D-F
  // 积分组 {2}:A {1.5}:B,C {1}:D {0}:E,F
  // A 与 D 无合法边 => 至少 2 场跨组；最优 2 场（A-B/C-D 或 A-C/B-D），
  // 总差均为 1.0；3 场跨组的方案总差更大，必须被排除
  const plan = generatePairing({ players: ps, rounds: [r1, r2], manual: [] });
  assert.ok(plan.ok, plan.conflicts.map((c) => c.message).join(';'));
  assert.strictEqual(plan.crossCount, 2, `跨组数应为 2，实际 ${plan.crossCount}`);
  assert.strictEqual(plan.totalDiff2, 2, `总积分差应为 1.0，实际 ${points2Label(plan.totalDiff2)}`);
  const played = buildPlayedMap([r1, r2]);
  for (const p of plan.pairs) {
    assert.ok(!played.has(pairKey(p.aId, p.bId)), '不得重复交手');
  }
  console.log('✓ 字典序优化（先跨组数后积分差）');
}

// 9. 32 人规模性能
{
  const ps = mkPlayers(Array.from({ length: 32 }, (_, i) => `P${i + 1}`));
  // 每人都已打过 3 轮（制造约束），用引擎反推不易；直接首轮同分组最坏情况
  const t0 = Date.now();
  const plan = generatePairing({ players: ps, rounds: [], manual: [] });
  const ms = Date.now() - t0;
  assert.ok(plan.ok);
  assert.strictEqual(plan.pairs.length, 16);
  assert.ok(ms < 5000, `32 人首轮配对应在 5s 内，实际 ${ms}ms`);
  console.log(`✓ 32 人规模性能：${ms}ms`);
}

// 10. 锁定导致奇数人无法轮空（所有人被锁定占用的极端例子：3 人锁一场 + 奇数）
{
  const ps = mkPlayers(['A', 'B', 'C']);
  const [A, B] = ps;
  const plan = generatePairing({ players: ps, rounds: [], manual: [lock(A.id, B.id)] });
  assert.ok(plan.ok, '3 人锁 1 场后应给第三人轮空');
  assert.strictEqual(plan.pairs.length, 1);
  console.log('✓ 奇数人锁定一场，余者轮空');
}

// 11. 冲突诊断：K1,3 星形约束（偶数人但无完美匹配）
{
  // 4 人：中心 X 与 L1/L2/L3 都交手过，叶子之间未交手。
  // 合法图为星形 K1,3：任何配对中最多容纳一条边，无法配成 2 场。
  const ps = mkPlayers(['X', 'L1', 'L2', 'L3']);
  const [X, L1, L2, L3] = ps;
  const roundsK: Round[] = [];
  roundsK.push(round([match(X.id, L1.id), match(L2.id, L3.id)]));
  roundsK.push(round([match(X.id, L2.id), match(L1.id, L3.id)]));
  roundsK.push(round([match(X.id, L3.id), match(L1.id, L2.id)]));
  const plan = generatePairing({ players: ps, rounds: roundsK, manual: [] });
  assert.ok(!plan.ok, 'K1,3 合法图无完美匹配，应判无解');
  assert.ok(
    plan.conflicts.some((c) => c.message.includes(X.name) || c.message.includes('瓶颈')),
    '应指出瓶颈选手',
  );
  console.log('✓ 冲突诊断：K1,3 无完美匹配（Tutte 瓶颈）');
}

// 12. 压力：32 人，随机合法历史 6 轮后生成第 7 轮
{
  const N = 32;
  const ps = mkPlayers(Array.from({ length: N }, (_, i) => `P${i + 1}`));
  const rounds: Round[] = [];
  const playedStress = new Set<string>();
  // 可复现的简单 LCG 随机
  let seed = 123456789;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let r = 0; r < 6; r++) {
    const pool = ps.map((p) => p.id);
    const matches: Round['matches'] = [];
    while (pool.length >= 2) {
      const ai = Math.floor(rand() * pool.length);
      const a = pool.splice(ai, 1)[0];
      let bi = pool.findIndex((b) => !playedStress.has(pairKey(a, b)));
      if (bi === -1) bi = Math.floor(rand() * pool.length);
      const b = pool.splice(bi, 1)[0];
      playedStress.add(pairKey(a, b));
      const roll = rand();
      const result = roll < 0.7 ? 'win' : roll < 0.85 ? 'draw' : 'loss';
      matches.push({ id: `s${r}_${a}_${b}`, playerAId: a, playerBId: b, resultA: result });
    }
    if (pool.length === 1) {
      matches.push({
        id: `s${r}_bye_${pool[0]}`,
        playerAId: pool[0],
        playerBId: null,
        resultA: 'win',
        bye: true,
      });
    }
    rounds.push(round(matches));
  }
  const t0 = Date.now();
  const plan = generatePairing({ players: ps, rounds, manual: [] });
  const ms = Date.now() - t0;
  assert.ok(plan.ok, plan.conflicts.map((c) => c.message).join(';'));
  assert.strictEqual(plan.pairs.length, N / 2);
  const playedFinal = buildPlayedMap(rounds);
  for (const p of plan.pairs) {
    assert.ok(!playedFinal.has(pairKey(p.aId, p.bId)), '压力测试中出现重复交手');
  }
  assert.ok(ms < 5000, `多轮约束配对应在 5s 内，实际 ${ms}ms`);
  console.log(`✓ 32 人 6 轮历史后配对：${ms}ms，跨组 ${plan.crossCount} 场`);
}

console.log('\n全部引擎自测通过 ✅');
