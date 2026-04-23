'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { use } from 'react';
import { getPublicAppUrl } from '@/lib/appUrl';

interface TeamInfo {
  id: string;
  name: string;
  color: string;
}

export default function LobbyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [roomStatus, setRoomStatus] = useState<string>('lobby');
  const [config, setConfig] = useState<{ startingBudget: number; timerDuration: number; maxTeams: number } | null>(null);
  const [isFacilitator, setIsFacilitator] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsFacilitator(!!sessionStorage.getItem(`facilitator_${code}`));
  }, [code]);

  const fetchRoom = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms/${code}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
        return;
      }
      setTeams(data.teams);
      setRoomStatus(data.status);
      setConfig(data.config);
      if (data.status === 'active') {
        router.push(`/room/${code}/play`);
      }
    } catch {
      setError('Failed to connect to room');
    }
  }, [code, router]);

  useEffect(() => {
    fetchRoom();
    const interval = setInterval(fetchRoom, 2000);
    return () => clearInterval(interval);
  }, [fetchRoom]);

  async function handleStart() {
    const facilitatorToken = sessionStorage.getItem(`facilitatorToken_${code}`);
    if (!facilitatorToken) {
      setError('Missing facilitator session token. Recreate room from home.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/rooms/${code}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${facilitatorToken}`,
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push(`/room/${code}/play`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start game');
    } finally {
      setLoading(false);
    }
  }

  function copyCode() {
    const roomUrl = `${getPublicAppUrl()}/room/${code.toUpperCase()}/lobby`;
    navigator.clipboard.writeText(roomUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (roomStatus === 'ended') {
    return (
      <div className="app-shell app-shell-inner flex flex-col items-center justify-center min-h-screen px-4">
        <div className="glass-card p-10 text-center max-w-md w-full fade-in">
          <p className="font-display text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            This game wrapped
          </p>
          <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>
            The room is closed. Start a fresh session from home.
          </p>
          <button className="btn btn-primary btn-lg w-full" onClick={() => router.push('/')}>
            Back to home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell app-shell-inner flex flex-col flex-1 items-center justify-center min-h-screen px-4 py-6 sm:py-10 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute top-[-18%] right-[-12%] w-[480px] h-[480px] rounded-full opacity-[0.11]"
          style={{ background: 'radial-gradient(circle, #ea580c 0%, transparent 70%)' }}
        />
        <div
          className="absolute bottom-[-25%] left-[-15%] w-[520px] h-[520px] rounded-full opacity-[0.08]"
          style={{ background: 'radial-gradient(circle, #14b8a6 0%, transparent 72%)' }}
        />
      </div>

      <div className="relative z-10 flex flex-col items-center max-w-lg w-full stagger-children">
        <div className="text-center mb-7 sm:mb-10 w-full">
          <p
            className="text-[11px] font-bold uppercase tracking-[0.2em] mb-3"
            style={{ color: 'var(--text-muted)' }}
          >
            Room code
          </p>
          <button
            type="button"
            className="font-mono text-[2rem] min-[390px]:text-4xl sm:text-5xl font-black tracking-[0.22em] sm:tracking-[0.35em] px-6 sm:px-8 py-4 rounded-2xl cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.99] w-full max-w-sm border shadow-lg"
            style={{
              background: 'linear-gradient(165deg, rgba(255,255,255,0.95), rgba(250,248,245,0.98))',
              borderColor: 'var(--border-default)',
              color: 'var(--accent-warning)',
              boxShadow: '0 16px 40px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.5)',
            }}
            onClick={copyCode}
            title="Click to copy"
          >
            {code.toUpperCase()}
          </button>
          <p
            className="text-xs mt-3 transition-colors"
            style={{ color: copied ? 'var(--accent-success)' : 'var(--text-muted)' }}
          >
            {copied ? 'Copied room link' : 'Tap to copy room link'}
          </p>
        </div>

        {config && (
          <div className="grid grid-cols-1 min-[430px]:grid-cols-3 gap-2 sm:gap-3 mb-6 sm:mb-8 w-full">
            <div className="panel px-3 py-4 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                Budget
              </div>
              <div className="text-lg font-bold font-mono" style={{ color: 'var(--accent-success)' }}>
                ${config.startingBudget}
              </div>
            </div>
            <div className="panel px-3 py-4 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                Timer
              </div>
              <div className="text-lg font-bold font-mono" style={{ color: 'var(--accent-warning)' }}>
                {Math.round(config.timerDuration / 60)}m
              </div>
            </div>
            <div className="panel px-3 py-4 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                Cap
              </div>
              <div className="text-lg font-bold font-mono" style={{ color: 'var(--accent-info)' }}>
                {config.maxTeams}
              </div>
            </div>
          </div>
        )}

        <div className="glass-card p-5 sm:p-6 w-full mb-5 sm:mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
              In the lobby
            </h2>
            <span className="text-xs font-mono font-bold px-2 py-1 rounded-lg border" style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}>
              {teams.length}/{config?.maxTeams ?? '?'}
            </span>
          </div>

          {teams.length === 0 ? (
            <div className="text-center py-10 rounded-xl border border-dashed" style={{ borderColor: 'var(--border-default)' }}>
              <div className="text-3xl mb-2 opacity-50">⏳</div>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Waiting for teams to join. Share the code above.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {teams.map((team, idx) => (
                <li
                  key={team.id}
                  className="flex items-center gap-3 p-3 rounded-xl border transition-colors"
                  style={{
                    background: 'var(--bg-surface)',
                    borderColor: 'var(--border-subtle)',
                    animationDelay: `${idx * 0.06}s`,
                  }}
                >
                  <div className="w-3 h-3 rounded-full flex-shrink-0 ring-2 ring-white/10" style={{ background: team.color }} />
                  <span className="font-semibold text-sm flex-1">{team.name}</span>
                  <span
                    className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
                    style={{
                      background: 'rgba(20, 184, 166, 0.12)',
                      color: 'var(--accent-success)',
                    }}
                  >
                    Ready
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <div
            className="mb-4 p-3 rounded-xl text-sm w-full text-center border"
            style={{
              background: 'rgba(239, 68, 68, 0.08)',
              borderColor: 'rgba(239, 68, 68, 0.25)',
              color: 'var(--accent-danger)',
            }}
          >
            {error}
          </div>
        )}

        {isFacilitator ? (
          <button
            className="btn btn-success btn-lg w-full shadow-lg"
            onClick={handleStart}
            disabled={loading || teams.length < 1}
          >
            {loading ? 'Starting…' : `Open the floor (${teams.length} team${teams.length !== 1 ? 's' : ''})`}
          </button>
        ) : (
          <div className="text-center py-2 w-full">
            <div className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border" style={{ borderColor: 'var(--border-default)', background: 'rgba(20, 184, 166, 0.06)' }}>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: 'var(--accent-success)' }} />
              </span>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Waiting for the host to start the round…
              </p>
            </div>
          </div>
        )}

        <button className="btn btn-ghost mt-4 sm:mt-5 w-full sm:w-auto" onClick={() => router.push('/')}>
          Leave room
        </button>
      </div>
    </div>
  );
}
