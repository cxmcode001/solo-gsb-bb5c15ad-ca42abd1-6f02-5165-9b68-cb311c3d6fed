import { useState } from 'react';
import type { Player } from './types';

interface Props {
  players: Player[];
  hasRounds: boolean;
  onAdd: (names: string[]) => void;
  onRemove: (id: string) => void;
}

const MAX_PLAYERS = 32;

export function PlayersPanel({ players, hasRounds, onAdd, onRemove }: Props) {
  const [name, setName] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulk, setBulk] = useState('');

  const remaining = MAX_PLAYERS - players.length;

  const submitSingle = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (remaining <= 0) return;
    onAdd([trimmed]);
    setName('');
  };

  const submitBulk = () => {
    const names = bulk
      .split(/[\n,，、;；\t]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, remaining);
    if (names.length === 0) return;
    onAdd(names);
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

      <div className="row">
        <input
          value={name}
          placeholder="输入选手姓名后回车添加"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitSingle();
          }}
          disabled={remaining <= 0}
          maxLength={24}
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
            rows={4}
            placeholder={'每行一个姓名，也可用逗号/顿号分隔\n例如：\n张三\n李四\n王五、赵六'}
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
