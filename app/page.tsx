'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const FIXED_STARTING_BUDGET = 100;

export default function HomePage() {
  const router = useRouter();
  const [teamName, setTeamName] = useState('');
  const [budget] = useState(String(FIXED_STARTING_BUDGET));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleQuickStart() {
    if (!teamName.trim()) {
      setError('Team name is required');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/rooms/quick-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamName: teamName.trim(),
          startingBudget: FIXED_STARTING_BUDGET,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      sessionStorage.setItem(`facilitator_${data.roomCode}`, data.facilitatorId);
      sessionStorage.setItem(`facilitatorToken_${data.roomCode}`, data.facilitatorToken);
      sessionStorage.setItem(`team_${data.roomCode}`, JSON.stringify({
        id: data.teamId,
        name: data.teamName,
        color: data.teamColor,
        playerId: data.playerId,
        playerName: data.playerName,
        token: data.playerToken,
      }));
      router.push(`/room/${data.roomCode}/play`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start game');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell app-shell-inner flex flex-col flex-1 items-center justify-center min-h-screen px-4 py-6 sm:py-10 relative overflow-hidden">
      {/* Decorative rails */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute -top-32 -left-24 w-[min(520px,90vw)] h-[min(520px,90vw)] rounded-full opacity-[0.12]"
          style={{ background: 'radial-gradient(circle, #ea580c 0%, transparent 68%)' }}
        />
        <div
          className="absolute -bottom-40 -right-20 w-[min(600px,95vw)] h-[min(600px,95vw)] rounded-full opacity-[0.1]"
          style={{ background: 'radial-gradient(circle, #14b8a6 0%, transparent 70%)' }}
        />
        <div
          className="absolute top-[35%] right-[8%] w-40 h-40 rounded-full opacity-[0.06] rotate-12"
          style={{ background: 'radial-gradient(circle, #fbbf24 0%, transparent 70%)' }}
        />
      </div>

      <div className="relative z-10 flex flex-col items-center max-w-md w-full stagger-children">
        <div className="text-center mb-7 sm:mb-10">
          <div
            className="inline-flex items-center gap-2 px-3 sm:px-4 py-1.5 rounded-full text-[10px] sm:text-[11px] font-bold tracking-[0.14em] sm:tracking-[0.18em] uppercase mb-5 sm:mb-6 border"
            style={{
              background: 'rgba(234, 88, 12, 0.08)',
              borderColor: 'var(--border-default)',
              color: 'var(--accent-warning)',
            }}
          >
            <span aria-hidden>🏷️</span>
            Competitive thrift tycoon
          </div>
          <h1 className="font-display text-4xl min-[390px]:text-5xl sm:text-6xl font-extrabold tracking-tight mb-3 text-gradient-brand">
            Busy Thrift
          </h1>
          <p className="text-sm sm:text-base max-w-sm mx-auto leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Buy low from the rack. Sell high to the crowd. Out-thrift every other team before the clock runs out.
          </p>
        </div>

        <div className="w-full fade-in">
          <div className="glass-card p-5 sm:p-7">
            <h2 className="font-display text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
              Quick Solo Start
            </h2>
            <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
              Enter your team name and jump straight into a one-team game.
            </p>

            <div className="space-y-4">
              <div>
                <label
                  className="block text-[11px] font-bold uppercase tracking-wider mb-1.5"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Team name
                </label>
                <input
                  type="text"
                  className="input"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder='e.g. "Rack Raiders"'
                  maxLength={20}
                />
              </div>

              <div>
                <label
                  className="block text-[11px] font-bold uppercase tracking-wider mb-1.5"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Starting budget
                </label>
                <div className="relative">
                  <span
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    $
                  </span>
                  <input
                    type="number"
                    className="input pl-8"
                    value={budget}
                    readOnly
                    aria-readonly="true"
                  />
                </div>
              </div>
            </div>

            {error && (
              <div
                className="mt-4 p-3 rounded-xl text-sm border"
                style={{
                  background: 'rgba(239, 68, 68, 0.08)',
                  borderColor: 'rgba(239, 68, 68, 0.25)',
                  color: 'var(--accent-danger)',
                }}
              >
                {error}
              </div>
            )}

            <div className="mt-7">
              <button className="btn btn-success w-full" onClick={handleQuickStart} disabled={loading}>
                {loading ? 'Starting…' : 'Start game now'}
              </button>
            </div>
          </div>
        </div>

        <p className="mt-8 sm:mt-10 text-[10px] sm:text-[11px] tracking-wide text-center" style={{ color: 'var(--text-muted)' }}>
          Club event edition · 20–30 minute sessions · Real-time marketplace
        </p>
      </div>
    </div>
  );
}
