import { useState } from 'react';
import type { Player } from './types';

interface Props {
  players: Player[];
  hasRounds: boolean;
  onAdd: (entries: { name: string; team?: string }[]) => void;
  onRemove: (id: string) => void;
  onSetTeam: (id: string, team: string) => void;
}

const MAX_PLAYERS = 32;

/** 解析“姓名”或“姓名/队伍”（也兼容 : ：、| 分隔，取第一个分隔符前为姓名、其后为队伍） */
function parseEntry(raw: string): { name: string; team?: string } | null {
  const line = raw.trim();
  if (!line) return null;
  const m = line.match(/^([^/|:：]+)\s*[/|:：]\s*(.+)$/);
  if (!m) return { name: line };
  const name = m[1].trim();
  const team = m[2].trim();
  return team ? { name, team } : { name };
}

export function PlayersPanel({ players, hasRounds, onAdd, onRemove, onSetTeam }: Props) {
  const [name, setName] = useState('');
  const [team, setTeam] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulk, setBulk] = useState('');

  const remaining = MAX_PLAYERS - players.length;

  const submitSingle = () => {
    const trimmed = name.trim();
    if (!trimmed || remaining <= 0) return;
    onAdd([{ name: trimmed, team: team.trim() }]);
    setName('');
    setTeam('');
  };

  const submitBulk = () => {
    const entries = bulk
      .split(/[\n,，、;；]+/)
      .map(parseEntry)
      .filter((e): e is { name: string; team?: string } => e !== null)
      .slice(0, remaining);
    if (entries.length === 0) return;
    onAdd(entries);
    setBulk('');
    setBulkOpen(false);
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>选手名单</h2>
        <span className="pill">
          {players.length} / {MAX_PLAYERS}
        </span>
      </div>

      <div className="row wrap">
        <input
          value={name}
          placeholder="选手姓名（必填）"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitSingle();
          }}
          disabled={remaining <= 0}
          maxLength={24}
        />
        <input
          className="team-input"
          value={team}
          placeholder="队伍（可选）"
          onChange={(e) => setTeam(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitSingle();
          }}
          disabled={remaining <= 0}
          maxLength={24}
          title="填写相同队伍名称的选手将尽量回避互相对阵"
        />
        <button className="btn primary" onClick={submitSingle} disabled={remaining <= 0 || !name.trim()}>
          添加
        </button>
        <button className="btn ghost" onClick={() => setBulkOpen((v) => !v)}>
          批量录入
        </button>
      </div>

      {bulkOpen && (
        <div className="bulk">
          <textarea
            value={bulk}
            rows={5}
            placeholder={
              '每行一条，可用逗号/顿号分隔；格式为「姓名」或「姓名/队伍」（分隔符可用 / : ： |）\n' +
              '例如：\n张三/红队\n李四/红队\n王五、赵六/蓝队'
            }
            onChange={(e) => setBulk(e.target.value)}
          />
          <div className="row end">
            <button className="btn primary" onClick={submitBulk} disabled={!bulk.trim() || remaining <= 0}>
              导入（最多 {remaining} 人）
            </button>
          </div>
        </div>
      )}

      {remaining <= 0 && <p className="hint warn">已达到 {MAX_PLAYERS} 人上限。</p>}

      {players.length > 0 ? (
        <ul className="player-list">
          {players.map((p, i) => (
            <li key={p.id}>
              <span className="idx">{i + 1}</span>
              <span className="name">{p.name}</span>
              <input
                className="team-edit"
                value={p.team ?? ''}
                placeholder="队伍（可选）"
                maxLength={24}
                title="修改队伍不影响已完成轮次的赛果与积分，仅作用于下一轮配对"
                onChange={(e) => onSetTeam(p.id, e.target.value)}
              />
              <button
                className="btn tiny danger"
                title="删除该选手"
                onClick={() => {
                  const msg = hasRounds
                    ? `删除「${p.name}」将保留历史轮次记录但其积分不再统计，确定删除？`
                    : `确定删除「${p.name}」？`;
                  if (window.confirm(msg)) onRemove(p.id);
                }}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">尚未录入选手，先添加至少 2 名选手。</p>
      )}
    </section>
  );
}
