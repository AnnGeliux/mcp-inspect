import React from 'react';
import { SessionInfo } from '../../shared/types';

interface Props {
  sessions: SessionInfo[];
  activeServerId: string | null;
  onSelect: (serverId: string) => void;
  onClose: (serverId: string) => void;
}

/**
 * SessionTabs — one tab per live proxy session (multi-server, M1).
 *
 * The tab shows name + transport kind + a status dot:
 *   ● green = capturing, ○ gray = stopped, ⏸ warning = paused.
 * The close ✕ tears the session down (flush holds + stop subprocess);
 * it does NOT delete the saved server.
 */
export default function SessionTabs(props: Props): React.ReactElement | null {
  const { sessions, activeServerId, onSelect, onClose } = props;
  if (sessions.length === 0) return null;

  return (
    <div className="session-tabs" role="tablist" aria-label="Live sessions">
      {sessions.map((s) => {
        const active = s.serverId === activeServerId;
        const dot = s.paused
          ? <span className="tab-dot paused" title="Traffic paused (frozen)">⏸</span>
          : s.running
            ? <span className="tab-dot live" title="Capturing traffic">●</span>
            : <span className="tab-dot stopped" title="Stopped">○</span>;
        return (
          <div
            key={s.serverId}
            role="tab"
            aria-selected={active}
            className={`session-tab ${active ? 'active' : ''}`}
            onClick={() => onSelect(s.serverId)}
          >
            {dot}
            <span className="tab-name">{s.name}</span>
            <span className="tab-kind" title={`Transport: ${s.kind}`}>{s.kind}</span>
            {(s.queued.c2s + s.queued.s2c) > 0 && (
              <span className="tab-queued" title="Messages queued while paused">{s.queued.c2s + s.queued.s2c}</span>
            )}
            <button
              className="tab-close"
              title="Close session (stops the server — the saved card stays)"
              onClick={(e) => {
                e.stopPropagation();
                onClose(s.serverId);
              }}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}