import { useMemo } from 'react';
import type { DraftPair, Player, Round } from './types';
import {
  computeStandings,
  generatePairing,
  points2Label,
  type PairingPlan,
  type PlanPair,
  type Standing,
} from './engine';
import { uid } from './uid';

interface Props {
  players: Player[];
  rounds: Round[];
  manual: DraftPair[];
  onManualChange: (rows: DraftPair[]) => void;
  onCommit: (plan: PairingPlan) => void;
}

export function NextRoundPanel({ players, rounds, manual, onManualChange, onCommit }: Props) {
  const roundNo = rounds.length + 1;
  const standings = useMemo(() => computeStandings(players, rounds), [players, rounds]);
  const standingById = useMemo(() => new Map(standings.map((s) => [s.player.id, s])), [standings]);

  // 未填写完整的锁定行不参与引擎，单独提示
  const incomplete = manual.filter((r) => r.locked && (!r.aId || !r.bId));
  const completeManual = useMemo(() => manual.filter((r) => r.locked && r.aId && r.bId), [manual]);
  const plan = useMemo(
    () => generatePairing({ players, rounds, manual: completeManual }),
    [players, rounds, completeManual],
  );

  const lastRound = rounds[rounds.length - 1];
  const pendingResults = lastRound
    ? lastRound.matches.some((m) => !m.bye && m.playerBId !== null && m.resultA === null)
    : false;

  const updateRow = (id: string, patch: Partial<DraftPair>) => {
    onManualChange(manual.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const removeRow = (id: string) => onManualChange(manual.filter((r) => r.id !== id));
  const addRow = () =>
    onManualChange([...manual, { id: uid('lock'), aId: '', bId: '', locked: true }]);

  /** 锁定引擎给出的一条自由对局 */
  const lockPlanPair = (p: PlanPair) => {
    onManualChange([
      ...manual,
      { id: uid('lock'), aId: p.aId, bId: p.bId, locked: true },
    ]);
  };

  const usedIds = new Set<string>();
  for (const r of manual) {
    if (r.aId) usedIds.add(r.aId);
    if (r.bId) usedIds.add(r.bId);
  }
  if (plan.byeId) usedIds.add(plan.byeId);

  return (
    <section className="card highlight">
      <div className="card-head">
        <h2>第 {roundNo} 轮对阵工作区</h2>
        <span className="pill">规则自动重算</span>
      </div>

      {players.length < 2 ? (
        <p className="hint">至少添加 2 名选手后才能生成对阵。</p>
      ) : (
        <>
          {pendingResults && (
            <p className="hint warn">
              ⚠ 上一轮仍有赛果未录入，当前积分与配对可能不符合预期，请先补录上一轮赛果。
            </p>
          )}

          <div className="row wrap">
            <button className="btn primary" onClick={() => onManualChange([])}>
              {manual.length > 0 ? '清除全部锁定并重新生成' : '重新生成对阵'}
            </button>
            <button className="btn" onClick={addRow}>
              ＋ 添加人工指定对局
            </button>
            {plan.ok && (
              <button
                className="btn success"
                onClick={() => onCommit(plan)}
                title="将当前方案（含轮空）写入新一轮"
              >
                ✓ 确认方案，进入第 {roundNo} 轮
              </button>
            )}
          </div>

          {/* 人工锁定行 */}
          {manual.length > 0 && (
            <div className="manual-box">
              <h3>人工锁定对局</h3>
              {manual.map((row) => (
                <ManualRow
                  key={row.id}
                  row={row}
                  players={players}
                  usedIds={usedIds}
                  standingById={standingById}
                  onChange={(patch) => updateRow(row.id, patch)}
                  onRemove={() => removeRow(row.id)}
                />
              ))}
            </div>
          )}
          {incomplete.length > 0 && (
            <p className="hint warn">有 {incomplete.length} 条锁定对局未选择双方，暂未参与计算。</p>
          )}

          {/* 冲突 */}
          {!plan.ok && (
            <div className="conflicts">
              <h3>✕ 当前约束无可行配对，冲突原因：</h3>
              <ol>
                {plan.conflicts.map((c, i) => (
                  <li key={i}>{c.message}</li>
                ))}
              </ol>
            </div>
          )}

          {/* 方案展示 */}
          {plan.ok && (
            <>
              <div className="stats">
                <span className="stat">
                  对局数 <b>{plan.pairs.length}</b>
                </span>
                <span className="stat">
                  同队对局{' '}
                  <b className={plan.sameTeamCount > 0 ? 'danger-text' : ''}>{plan.sameTeamCount}</b>
                </span>
                <span className="stat">
                  跨积分组对局 <b className={plan.crossCount > 0 ? 'accent' : ''}>{plan.crossCount}</b>
                </span>
                <span className="stat">
                  总积分差 <b>{points2Label(plan.totalDiff2)}</b>
                </span>
                {plan.optimal ? (
                  <span className="tag ok">已最小化（最优）</span>
                ) : (
                  <span className="tag warn">可行方案（未证明最优）</span>
                )}
              </div>

              <p className="hint">
                目标顺序：① 禁止重复交手 → ② 同队对局数最少 → ③ 跨积分组对局数最少 → ④ 双方总积分差之和最小。
              </p>

              {plan.sameTeamCount > 0 && (
                <SameTeamNotice plan={plan} standingById={standingById} />
              )}

              {plan.byeId && (
                <div className="bye-box">
                  本轮轮空（奇数人数）：
                  <b>{standingById.get(plan.byeId)?.player.name}</b>
                  <span className="muted">
                    （{points2Label(standingById.get(plan.byeId)?.points2 ?? 0)} 分
                    {standingById.get(plan.byeId)?.hadBye ? '' : '，此前未轮空'}，计 1 分）
                  </span>
                </div>
              )}

              <ul className="plan-list">
                {plan.pairs.map((p, i) => {
                  const sa = standingById.get(p.aId)!;
                  const sb = standingById.get(p.bId)!;
                  return (
                    <li
                      key={`${p.aId}-${p.bId}`}
                      className={[p.locked ? 'locked' : '', p.sameTeam ? 'team-hit' : '']
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <span className="idx">{i + 1}</span>
                      <span className="plan-names">
                        <PlayerChip s={sa} />
                        <span className="vs">vs</span>
                        <PlayerChip s={sb} />
                      </span>
                      <span className="plan-tags">
                        {p.sameTeam && (
                          <span className="tag team" title={`双方同属队伍「${p.team ?? ''}」`}>
                            同队 · {p.team}
                          </span>
                        )}
                        {p.crossGroup && <span className="tag cross">跨组</span>}
                        {p.diff2 > 0 && (
                          <span className="tag">Δ {points2Label(p.diff2)}</span>
                        )}
                        {!p.crossGroup && p.diff2 === 0 && <span className="tag ok">同分组</span>}
                        {p.locked ? (
                          <span className="tag lock">🔒 锁定</span>
                        ) : (
                          <button
                            className="btn tiny"
                            onClick={() => lockPlanPair(p)}
                            title="锁定此对局后，其余选手将在此约束下重新配对"
                          >
                            🔒 锁定此场
                          </button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>

              {plan.warnings.length > 0 && (
                <ul className="warnings">
                  {plan.warnings.map((w, i) => (
                    <li key={i}>⚠ {w}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

function PlayerChip({ s }: { s: Standing }) {
  const team = s.player.team?.trim();
  return (
    <span className="chip">
      {s.player.name}
      {team && <em className="chip-team" title={`队伍：${team}`}>{team}</em>}
      <em>{points2Label(s.points2)}</em>
    </span>
  );
}

/** 同队对局无法完全回避时：给出最少冲突数、涉及选手，并标注其中人工锁定的场次 */
function SameTeamNotice({
  plan,
  standingById,
}: {
  plan: PairingPlan;
  standingById: Map<string, Standing>;
}) {
  const hits = plan.pairs.filter((p) => p.sameTeam);
  const byTeam = new Map<string, { pair: PlanPair; locked: boolean }[]>();
  for (const p of hits) {
    const t = p.team ?? '';
    const list = byTeam.get(t) ?? [];
    list.push({ pair: p, locked: p.locked });
    byTeam.set(t, list);
  }

  return (
    <div className="team-notice">
      <h3>
        ⚠ 受「禁止重复交手」与人工锁定约束，本轮无法完全回避同队对局：最少需要{' '}
        <b>{plan.sameTeamCount}</b> 场同队对局
        {plan.optimal ? '（已证明最少）' : '（当前可行方案中的最小值，未证明全局最优）'}
      </h3>
      <ul>
        {[...byTeam.entries()].map(([t, items]) => (
          <li key={t}>
            队伍「{t}」：
            {items
              .map(({ pair, locked }) => {
                const na = standingById.get(pair.aId)?.player.name ?? pair.aId;
                const nb = standingById.get(pair.bId)?.player.name ?? pair.bId;
                return `${na} vs ${nb}${locked ? '（人工锁定）' : ''}`;
              })
              .join('；')}
          </li>
        ))}
      </ul>
      <p className="hint">涉及选手：{[...new Set(hits.flatMap((p) => [p.aId, p.bId]))]
        .map((id) => standingById.get(id)?.player.name ?? id)
        .join('、')}</p>
    </div>
  );
}

function ManualRow({
  row,
  players,
  usedIds,
  standingById,
  onChange,
  onRemove,
}: {
  row: DraftPair;
  players: Player[];
  usedIds: Set<string>;
  standingById: Map<string, Standing>;
  onChange: (patch: Partial<DraftPair>) => void;
  onRemove: () => void;
}) {
  const sorted = [...players].sort((a, b) => {
    const sa = standingById.get(a.id);
    const sb = standingById.get(b.id);
    if (!sa || !sb) return 0;
    if (sb.points2 !== sa.points2) return sb.points2 - sa.points2;
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });

  const optionLabel = (pId: string) => {
    const p = players.find((q) => q.id === pId);
    const base = standingById.get(pId)?.player.name ?? p?.name ?? pId;
    const t = p?.team?.trim();
    return t ? `${base}（${t}）` : base;
  };

  const optionsFor = (self: string, other: string | null) =>
    sorted.filter((p) => p.id === self || (other !== null && p.id === other) || !usedIds.has(p.id));

  const warn = !row.aId || !row.bId;
  const sameTeam =
    row.aId &&
    row.bId &&
    (players.find((p) => p.id === row.aId)?.team?.trim() ?? '') !== '' &&
    (players.find((p) => p.id === row.aId)?.team?.trim() ?? '') ===
      (players.find((p) => p.id === row.bId)?.team?.trim() ?? '');

  return (
    <div className={`manual-row ${warn ? 'incomplete' : ''}`}>
      <span className="tag lock">🔒</span>
      <select value={row.aId} onChange={(e) => onChange({ aId: e.target.value })}>
        <option value="">选择选手 A…</option>
        {optionsFor(row.aId, row.bId ?? null).map((p) => (
          <option key={p.id} value={p.id}>
            {optionLabel(p.id)}
          </option>
        ))}
      </select>
      <span className="vs">vs</span>
      <select value={row.bId ?? ''} onChange={(e) => onChange({ bId: e.target.value })}>
        <option value="">选择选手 B…</option>
        {optionsFor(row.bId ?? '', row.aId).map((p) => (
          <option key={p.id} value={p.id}>
            {optionLabel(p.id)}
          </option>
        ))}
      </select>
      {sameTeam && <span className="tag team">同队对局（计入指标）</span>}
      <button className="btn tiny danger" onClick={onRemove}>
        移除
      </button>
    </div>
  );
}
