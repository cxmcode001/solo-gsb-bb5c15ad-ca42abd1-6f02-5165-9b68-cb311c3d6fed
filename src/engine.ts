import type { DraftPair, Player, Round } from './types';

// ===== 积分（内部使用整数半分制：1 分 = 2，和棋 = 1，负 = 0） =====

export const WIN_POINTS2 = 2;
export const DRAW_POINTS2 = 1;
export const LOSS_POINTS2 = 0;
export const BYE_POINTS2 = WIN_POINTS2; // 轮空按胜场计分

export function points2Label(points2: number): string {
  return points2 % 2 === 0 ? `${points2 / 2}` : `${(points2 / 2).toFixed(1)}`;
}

export interface Standing {
  player: Player;
  points2: number;
  opponents: (string | null)[]; // 同轮序对齐；轮空对手为 null
  hadBye: boolean;
  buchholz2: number; // 对手总积分（轮空轮次按自己当轮赛前积分近似不参与：见下）
}

/**
 * 计算积分排名。
 * Buchholz（对手分）：每个已对局对手的当前总积分之和；轮空轮不计入对手分。
 * 同分名次依次按：Buchholz、姓名、id。
 */
export function computeStandings(players: Player[], rounds: Round[]): Standing[] {
  const points2 = new Map<string, number>();
  const opponents = new Map<string, (string | null)[]>();
  const byeSet = new Set<string>();

  for (const p of players) {
    points2.set(p.id, 0);
    opponents.set(p.id, []);
  }

  for (const round of rounds) {
    for (const m of round.matches) {
      const listA = opponents.get(m.playerAId);
      const listB = m.playerBId !== null ? opponents.get(m.playerBId) : undefined;
      // 选手可能已被删除：只要一方仍存在就继续处理，缺失方视为无名对手（计 0 分）
      if (!listA && !listB) continue;

      if (m.bye || m.playerBId === null) {
        if (listA) {
          byeSet.add(m.playerAId);
          listA.push(null);
          points2.set(m.playerAId, (points2.get(m.playerAId) ?? 0) + BYE_POINTS2);
        }
        continue;
      }

      if (listA) listA.push(m.playerBId);
      if (listB) listB.push(m.playerAId);

      const ra = m.resultA;
      const addA = ra === 'win' ? WIN_POINTS2 : ra === 'draw' ? DRAW_POINTS2 : ra === 'loss' ? LOSS_POINTS2 : 0;
      const addB = ra === 'win' ? LOSS_POINTS2 : ra === 'draw' ? DRAW_POINTS2 : ra === 'loss' ? WIN_POINTS2 : 0;
      if (listA) points2.set(m.playerAId, (points2.get(m.playerAId) ?? 0) + addA);
      if (listB) points2.set(m.playerBId, (points2.get(m.playerBId) ?? 0) + addB);
      // 尚未录入赛果时双方均不加分
    }
  }

  const standings: Standing[] = players.map((player) => ({
    player,
    points2: points2.get(player.id) ?? 0,
    opponents: opponents.get(player.id) ?? [],
    hadBye: byeSet.has(player.id),
    buchholz2: 0,
  }));

  const byId = new Map(standings.map((s) => [s.player.id, s]));
  for (const s of standings) {
    let buch = 0;
    for (const oppId of s.opponents) {
      if (oppId !== null) buch += byId.get(oppId)?.points2 ?? 0;
    }
    s.buchholz2 = buch;
  }

  standings.sort((a, b) => {
    if (b.points2 !== a.points2) return b.points2 - a.points2;
    if (b.buchholz2 !== a.buchholz2) return b.buchholz2 - a.buchholz2;
    const nameCmp = a.player.name.localeCompare(b.player.name, 'zh-Hans-CN');
    if (nameCmp !== 0) return nameCmp;
    return a.player.id < b.player.id ? -1 : 1;
  });
  return standings;
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** 历史上已经交手过的无序对局集合（轮空不算交手） */
export function buildPlayedMap(rounds: Round[]): Set<string> {
  const played = new Set<string>();
  for (const round of rounds) {
    for (const m of round.matches) {
      if (!m.bye && m.playerBId !== null) {
        played.add(pairKey(m.playerAId, m.playerBId));
      }
    }
  }
  return played;
}

/** 规范化队伍名称：去空白；空串视为无队伍（null） */
export function normalizeTeam(team: string | null | undefined): string | null {
  const t = (team ?? '').trim();
  return t.length > 0 ? t : null;
}

// ===== 下一轮配对规划 =====

export interface PlanConflict {
  /** 关联的锁定行 id（若冲突来自人工指定） */
  pairId?: string;
  playerId?: string;
  message: string;
}

export interface PlanPair {
  aId: string;
  bId: string; // 非轮空对局
  locked: boolean;
  crossGroup: boolean;
  diff2: number;
  sameTeam: boolean;
  /** 同队对局时的规范化队伍名称（用于在方案区分组展示） */
  team?: string;
}

export interface PairingPlan {
  ok: boolean;
  pairs: PlanPair[];
  byeId: string | null;
  /** 同队对局数（含人工锁定的同队对局） */
  sameTeamCount: number;
  crossCount: number;
  totalDiff2: number;
  conflicts: PlanConflict[];
  warnings: string[];
  optimal: boolean;
  note?: string;
}

export interface GenerateOptions {
  players: Player[];
  rounds: Round[];
  /** 人工指定（锁定）的对局，含未填写完整的行（bId 可能为 null） */
  manual: DraftPair[];
}

const NODE_BUDGET = 300_000;

export function generatePairing(opts: GenerateOptions): PairingPlan {
  const { players, rounds, manual } = opts;
  const empty: PairingPlan = {
    ok: false,
    pairs: [],
    byeId: null,
    sameTeamCount: 0,
    crossCount: 0,
    totalDiff2: 0,
    conflicts: [],
    warnings: [],
    optimal: false,
  };
  if (players.length < 2) {
    return { ...empty, conflicts: [{ message: '至少需要 2 名选手才能开始配对。' }] };
  }

  const standings = computeStandings(players, rounds);
  const standingById = new Map(standings.map((s) => [s.player.id, s]));
  const played = buildPlayedMap(rounds);
  const warnings: string[] = [];

  // ---- 1. 校验人工锁定行 ----
  const conflicts: PlanConflict[] = [];
  const seenLocked = new Set<string>();
  const lockedPairs: { pairId: string; aId: string; bId: string }[] = [];

  for (const row of manual) {
    if (!row.locked) continue;
    if (!row.aId || !row.bId) {
      conflicts.push({ pairId: row.id, message: '锁定行未填写完整：每一条锁定对局都必须选择两名选手。' });
      continue;
    }
    if (row.aId === row.bId) {
      conflicts.push({ pairId: row.id, playerId: row.aId, message: '锁定对局的双方不能是同一名选手。' });
      continue;
    }
    if (!standingById.has(row.aId) || !standingById.has(row.bId)) {
      conflicts.push({ pairId: row.id, message: '锁定对局引用了已不存在的选手，请重新选择。' });
      continue;
    }
    for (const pid of [row.aId, row.bId]) {
      if (seenLocked.has(pid)) {
        conflicts.push({
          pairId: row.id,
          playerId: pid,
          message: `选手「${standingById.get(pid)?.player.name ?? pid}」出现在多条锁定对局中，每人只能参加一场。`,
        });
      }
    }
    if (played.has(pairKey(row.aId, row.bId))) {
      const sa = standingById.get(row.aId)!;
      const sb = standingById.get(row.bId)!;
      conflicts.push({
        pairId: row.id,
        message: `锁定对局 ${sa.player.name} vs ${sb.player.name} 违反「禁止重复交手」：两人此前已经对阵过。`,
      });
    }
    seenLocked.add(row.aId);
    seenLocked.add(row.bId);
    lockedPairs.push({ pairId: row.id, aId: row.aId, bId: row.bId });
  }

  if (conflicts.length > 0) return { ...empty, conflicts, warnings };

  // ---- 2. 轮空分配 ----
  const lockedIds = new Set<string>();
  for (const lp of lockedPairs) {
    lockedIds.add(lp.aId);
    lockedIds.add(lp.bId);
  }

  let byeId: string | null = null;
  const oddTotal = players.length % 2 === 1;
  if (oddTotal) {
    const candidates = standings.filter((s) => !lockedIds.has(s.player.id));
    const noBye = candidates.filter((s) => !s.hadBye);
    let chosen: Standing | undefined;
    if (noBye.length > 0) {
      chosen = [...noBye].sort(compareByePriority)[0];
    } else {
      chosen = [...candidates].sort(compareByePriority)[0];
      warnings.push(
        `所有选手都已轮空过一次，本轮只能让积分最低的「${chosen?.player.name ?? ''}」再次轮空。`,
      );
    }
    if (!chosen) {
      conflicts.push({ message: '人数为奇数，但所有选手都被锁定对局占用，无人可以安排轮空。' });
      return { ...empty, conflicts, warnings };
    }
    // 若没有锁定，本应轮空的选手（全局：未轮空且积分最低）因被锁定而无法轮空
    const globalPool = noBye.length > 0 ? standings.filter((s) => !s.hadBye) : standings;
    const globalChoice = [...globalPool].sort(compareByePriority)[0];
    if (globalChoice && globalChoice.player.id !== chosen.player.id && lockedIds.has(globalChoice.player.id)) {
      warnings.push(
        `按积分与轮空规则，本应由「${globalChoice.player.name}」轮空，但其被锁定对局占用；` +
          `已改由未被锁定的选手中积分最低的「${chosen.player.name}」轮空。`,
      );
    }
    byeId = chosen.player.id;
  }

  // ---- 3. 自由选手与合法性矩阵 ----
  const free = standings.filter((s) => s.player.id !== byeId && !lockedIds.has(s.player.id));
  if (free.length % 2 !== 0) {
    conflicts.push({ message: '内部错误：扣除轮空与锁定选手后剩余人数为奇数，无法两两配对。' });
    return { ...empty, conflicts, warnings };
  }

  const n = free.length;

  const legal: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const ok = !played.has(pairKey(free[i].player.id, free[j].player.id));
      legal[i][j] = ok;
      legal[j][i] = ok;
    }
  }

  const legalDegree = (i: number, used: boolean[]) => {
    let d = 0;
    for (let j = 0; j < n; j++) if (!used[j] && legal[i][j]) d++;
    return d;
  };

  // ---- 4. 连通分量预检（奇分量 => 无解，并给出可读原因） ----
  const componentConflicts = checkComponents(free, legal, lockedPairs, played);
  if (componentConflicts) return { ...empty, conflicts: componentConflicts, warnings, byeId };

  // ---- 5. 分支限界搜索，字典序最小化 (同队对局数, 跨组数, 总积分差) ----
  // 积分组：相同 points2 为一组；队伍：规范化后的 team 名称，无队伍者不参与同队回避
  const distinctScores = [...new Set(free.map((s) => s.points2))].sort((a, b) => b - a);
  const groupAt = (i: number) => distinctScores.indexOf(free[i].points2);
  const teamAt = (i: number): string | null => normalizeTeam(free[i].player.team);

  const edgeSameTeam = (i: number, j: number): 0 | 1 => {
    const ti = teamAt(i);
    return ti !== null && ti === teamAt(j) ? 1 : 0;
  };
  const edgeCross = (i: number, j: number) => (groupAt(i) === groupAt(j) ? 0 : 1);
  const edgeDiff = (i: number, j: number) => Math.abs(free[i].points2 - free[j].points2);

  // 人工锁定对局构成方案指标的固定基数（锁定的同队对局允许保留并计入）
  let lockedSame = 0;
  let lockedCross = 0;
  let lockedDiff = 0;
  for (const lp of lockedPairs) {
    const sa = standingById.get(lp.aId)!;
    const sb = standingById.get(lp.bId)!;
    const ta = normalizeTeam(sa.player.team);
    if (ta !== null && ta === normalizeTeam(sb.player.team)) lockedSame++;
    if (sa.points2 !== sb.points2) lockedCross++;
    lockedDiff += Math.abs(sa.points2 - sb.points2);
  }

  const used = new Array<boolean>(n).fill(false);
  const chosenEdges: [number, number][] = [];
  let bestEdges: [number, number][] | null = null;
  let bestSame = Infinity;
  let bestCross = Infinity;
  let bestDiff = Infinity;
  let nodes = 0;
  let aborted = false;

  /** 当前未用顶点跨组边数的奇偶下界（跨组边改变分组奇偶，奇数组 => 至少需跨组） */
  function crossParityLowerBound(): number {
    const counts = new Array<number>(distinctScores.length).fill(0);
    for (let i = 0; i < n; i++) if (!used[i]) counts[groupAt(i)]++;
    let need = 0;
    for (const c of counts) if (c % 2 === 1) need++;
    return Math.floor(need / 2);
  }

  /**
   * 当前未用顶点同队边数的下界：每支队伍有 k 名待配对选手时，
   * 至多 (k 中能与外队匹配的部分) 可外连，配对成边后队内至少残留 ⌈k/2⌉ - (|V|-k) 条同队边
   * （等价于 max(0, 2k - |Vunused|) / 2 向上取整，队内奇偶所迫的同队边数）。
   */
  function sameTeamLowerBound(): number {
    const unused: number[] = [];
    for (let i = 0; i < n; i++) if (!used[i]) unused.push(i);
    const total = unused.length;
    const byTeam = new Map<string, number>();
    for (const i of unused) {
      const t = teamAt(i);
      if (t === null) continue;
      byTeam.set(t, (byTeam.get(t) ?? 0) + 1);
    }
    let lb = 0;
    for (const k of byTeam.values()) {
      lb += Math.max(0, Math.ceil((2 * k - total) / 2));
    }
    return lb;
  }

  function search(curSame: number, curCross: number, curDiff: number) {
    if (++nodes > NODE_BUDGET) {
      aborted = true;
      return;
    }
    if (chosenEdges.length === n / 2) {
      const totSame = lockedSame + curSame;
      const totCross = lockedCross + curCross;
      const totDiff = lockedDiff + curDiff;
      if (
        totSame < bestSame ||
        (totSame === bestSame && totCross < bestCross) ||
        (totSame === bestSame && totCross === bestCross && totDiff < bestDiff)
      ) {
        bestSame = totSame;
        bestCross = totCross;
        bestDiff = totDiff;
        bestEdges = chosenEdges.slice();
      }
      return;
    }

    // 剪枝：同队下界、跨组下界 + 与已有最优的字典序比较
    const lbSame = curSame + sameTeamLowerBound();
    const lbCross = curCross + crossParityLowerBound();
    if (bestEdges !== null) {
      const totLbSame = lockedSame + lbSame;
      if (totLbSame > bestSame) return;
      if (totLbSame === bestSame) {
        const totLbCross = lockedCross + lbCross;
        if (totLbCross > bestCross) return;
        if (totLbCross === bestCross && lockedDiff + curDiff >= bestDiff) return;
      }
    }

    // MRV：可选合法搭档最少的未配对选手优先；同分优先（优先尝试组内，尽快得到优解）
    let pivot = -1;
    let pivotDegree = Infinity;
    let pivotScore = -Infinity;
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const d = legalDegree(i, used);
      if (d === 0) return; // 死路
      const score = free[i].points2;
      if (d < pivotDegree || (d === pivotDegree && score > pivotScore)) {
        pivot = i;
        pivotDegree = d;
        pivotScore = score;
      }
    }

    const partners: number[] = [];
    for (let j = 0; j < n; j++) {
      if (!used[j] && j !== pivot && legal[pivot][j]) partners.push(j);
    }
    // 优先非同队、再组内、积分差小，利于先得到优解从而加强剪枝
    partners.sort((x, y) => {
      const tx = edgeSameTeam(pivot, x);
      const ty = edgeSameTeam(pivot, y);
      if (tx !== ty) return tx - ty;
      const cx = edgeCross(pivot, x);
      const cy = edgeCross(pivot, y);
      if (cx !== cy) return cx - cy;
      const dx = edgeDiff(pivot, x);
      const dy = edgeDiff(pivot, y);
      if (dx !== dy) return dx - dy;
      const scx = free[x].points2;
      const scy = free[y].points2;
      if (scx !== scy) return scy - scx;
      return x - y;
    });

    for (const j of partners) {
      used[pivot] = true;
      used[j] = true;
      chosenEdges.push([pivot, j]);
      search(curSame + edgeSameTeam(pivot, j), curCross + edgeCross(pivot, j), curDiff + edgeDiff(pivot, j));
      chosenEdges.pop();
      used[j] = false;
      used[pivot] = false;
      if (aborted) return;
    }
  }

  search(0, 0, 0);

  if (!bestEdges) {
    return {
      ...empty,
      byeId,
      warnings,
      conflicts: buildInfeasibilityConflicts(free, legal, lockedPairs, played),
    };
  }
  const finalEdges: [number, number][] = bestEdges;

  // ---- 6. 组装结果（锁定对 + 自由对） ----
  const planPairs: PlanPair[] = [];
  let sameTeamCount = 0;
  let crossCount = 0;
  let totalDiff2 = 0;

  for (const lp of lockedPairs) {
    const sa = standingById.get(lp.aId)!;
    const sb = standingById.get(lp.bId)!;
    const cross = sa.points2 !== sb.points2 ? 1 : 0;
    const diff = Math.abs(sa.points2 - sb.points2);
    const ta = normalizeTeam(sa.player.team);
    const tb = normalizeTeam(sb.player.team);
    const sameTeam = ta !== null && ta === tb;
    const team = sameTeam ? ta ?? undefined : undefined;
    if (sameTeam) sameTeamCount++;
    crossCount += cross;
    totalDiff2 += diff;
    planPairs.push({
      aId: lp.aId,
      bId: lp.bId,
      locked: true,
      crossGroup: cross === 1,
      diff2: diff,
      sameTeam,
      team,
    });
  }

  for (const [i, j] of finalEdges) {
    const cross = edgeCross(i, j) === 1;
    const diff = edgeDiff(i, j);
    const ti = teamAt(i);
    const sameTeam = ti !== null && ti === teamAt(j);
    const team = sameTeam ? ti ?? undefined : undefined;
    if (sameTeam) sameTeamCount++;
    crossCount += cross ? 1 : 0;
    totalDiff2 += diff;
    planPairs.push({
      aId: free[i].player.id,
      bId: free[j].player.id,
      locked: false,
      crossGroup: cross,
      diff2: diff,
      sameTeam,
      team,
    });
  }

  // 排序展示：高分组在前
  planPairs.sort((p, q) => {
    const sp = Math.max(standingById.get(p.aId)!.points2, standingById.get(p.bId)!.points2);
    const sq = Math.max(standingById.get(q.aId)!.points2, standingById.get(q.bId)!.points2);
    return sq - sp;
  });

  const result: PairingPlan = {
    ok: true,
    pairs: planPairs,
    byeId,
    sameTeamCount,
    crossCount,
    totalDiff2,
    conflicts: [],
    warnings,
    optimal: !aborted,
  };
  if (aborted) {
    result.warnings = [
      ...warnings,
      '搜索节点数达到上限，当前方案可行且较优，但不保证为严格最优；可减少锁定后重试。',
    ];
  }
  return result;
}

/** 轮空优先级：积分最低 → Buchholz 低 → 姓名 → id（computeStandings 为降序，这里独立排序） */
function compareByePriority(a: Standing, b: Standing): number {
  if (a.points2 !== b.points2) return a.points2 - b.points2;
  if (a.buchholz2 !== b.buchholz2) return a.buchholz2 - b.buchholz2;
  const nameCmp = a.player.name.localeCompare(b.player.name, 'zh-Hans-CN');
  if (nameCmp !== 0) return nameCmp;
  return a.player.id < b.player.id ? -1 : 1;
}

interface ComponentInfo {
  vertices: number[];
}

function computeComponents(n: number, legal: boolean[][]): ComponentInfo[] {
  const seen = new Array<boolean>(n).fill(false);
  const comps: ComponentInfo[] = [];
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue;
    const verts: number[] = [];
    const stack = [s];
    seen[s] = true;
    while (stack.length) {
      const v = stack.pop()!;
      verts.push(v);
      for (let j = 0; j < n; j++) {
        if (!seen[j] && legal[v][j]) {
          seen[j] = true;
          stack.push(j);
        }
      }
    }
    comps.push({ vertices: verts });
  }
  return comps;
}

function checkComponents(
  free: Standing[],
  legal: boolean[][],
  lockedPairs: { pairId: string; aId: string; bId: string }[],
  _played: Set<string>,
): PlanConflict[] | null {
  const n = free.length;
  const comps = computeComponents(n, legal);
  const odd = comps.filter((c) => c.vertices.length % 2 === 1);
  if (odd.length === 0) return null;

  const conflicts: PlanConflict[] = [];
  for (const comp of odd) {
    if (comp.vertices.length === 1) {
      const s = free[comp.vertices[0]];
      conflicts.push({
        playerId: s.player.id,
        message: `选手「${s.player.name}」(${points2Label(s.points2)} 分) 在待配对选手中没有任何合法搭档：与其余所有人都已交手，或其余人全部被锁定占用。`,
      });
      // 列出其对手证据
      const others = free.filter((o) => o.player.id !== s.player.id);
      const blocked = others.filter((o) => _played.has(pairKey(s.player.id, o.player.id)));
      if (blocked.length > 0) {
        conflicts.push({
          playerId: s.player.id,
          message: `「${s.player.name}」已与以下选手交手过：${blocked.map((b) => b.player.name).join('、')}。`,
        });
      }
    } else {
      const names = comp.vertices.map((i) => free[i].player.name);
      conflicts.push({
        message: `存在 ${comp.vertices.length} 名选手只能在彼此之间配对（人数为奇数，无法两两配完）：${names.join('、')}。原因是他们与组外选手都已交手过。`,
      });
    }
  }
  if (lockedPairs.length > 0) {
    conflicts.push({ message: '可尝试解锁部分人工对局，或将锁定改为跨积分组安排后重新计算。' });
  }
  return conflicts;
}

function buildInfeasibilityConflicts(
  free: Standing[],
  legal: boolean[][],
  lockedPairs: { pairId: string; aId: string; bId: string }[],
  played: Set<string>,
): PlanConflict[] {
  // 通常奇分量预检已覆盖；这里处理「偶数顶点但无完美匹配」（如星形 K1,3）
  const n = free.length;
  const conflicts: PlanConflict[] = [];

  /** 排除顶点集合 removed 后，按 legal 边计算奇大小连通分量 */
  function oddComponentsAfter(removed: boolean[]): number[][] {
    const seen = new Array<boolean>(n).fill(false);
    const oddComps: number[][] = [];
    for (let s = 0; s < n; s++) {
      if (seen[s] || removed[s]) continue;
      const verts: number[] = [];
      const stack = [s];
      seen[s] = true;
      while (stack.length) {
        const v = stack.pop()!;
        verts.push(v);
        for (let j = 0; j < n; j++) {
          if (removed[j] || seen[j] || !legal[v][j]) continue;
          seen[j] = true;
          stack.push(j);
        }
      }
      if (verts.length % 2 === 1) oddComps.push(verts);
    }
    return oddComps;
  }

  // Tutte 定理：无完美匹配 ⇔ 存在顶点集 S 使 G-S 的奇分量数 > |S|。
  // 先尝试单点 S（K1,3 等常见瓶颈即为此类）。
  for (let v = 0; v < n; v++) {
    const removed = new Array<boolean>(n).fill(false);
    removed[v] = true;
    const oddComps = oddComponentsAfter(removed);
    if (oddComps.length > 1) {
      const center = free[v];
      conflicts.push({
        playerId: center.player.id,
        message:
          `选手「${center.player.name}」(${points2Label(center.points2)} 分) 是配对瓶颈：` +
          `其余选手中存在 ${oddComps.length} 个彼此无法连通的奇数人分组，他们都只能（或优先）与「${center.player.name}」配对，` +
          `但 TA 一轮只能参加一场，故至少有一个分组无法配完。`,
      });
      for (const comp of oddComps.slice(0, 6)) {
        const names = comp.map((i) => free[i].player.name).join('、');
        conflicts.push({ message: `奇数分组（${comp.length} 人）：${names}` });
      }
      break;
    }
  }

  if (conflicts.length === 0) {
    // 兜底：列出自由度最低的选手及其受限原因
    const degrees = free.map((_, i) => {
      let d = 0;
      for (let j = 0; j < n; j++) if (j !== i && legal[i][j]) d++;
      return d;
    });
    const minDeg = Math.min(...degrees);
    const stuck = free.filter((_, i) => degrees[i] === minDeg).slice(0, 4);
    for (const s of stuck) {
      const i = free.indexOf(s);
      const blocked = free.filter((o, j) => j !== i && played.has(pairKey(s.player.id, o.player.id)));
      conflicts.push({
        playerId: s.player.id,
        message:
          `「${s.player.name}」(${points2Label(s.points2)} 分) 仅剩 ${minDeg} 个未交手对象；` +
          (blocked.length > 0
            ? `已与 ${blocked.map((b) => b.player.name).join('、')} 交手过。`
            : '其余选手可能均被锁定对局占用。'),
      });
    }
  }

  if (lockedPairs.length > 0) {
    conflicts.push({ message: '可尝试解锁部分人工对局，或将锁定改为跨积分组安排后重新计算。' });
  }
  if (conflicts.length === 0) {
    conflicts.push({ message: '在「禁止重复交手」约束下找不到完整配对方案，请检查锁定对局或历史赛果。' });
  }
  return conflicts;
}
