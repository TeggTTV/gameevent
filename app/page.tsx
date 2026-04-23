'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();
  const [mode, setMode] = useState<'idle' | 'create' | 'join'>('idle');
  const [roomCode, setRoomCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [budget, setBudget] = useState('500');
  const [timer, setTimer] = useState('20');
  const [maxTeams, setMaxTeams] = useState('6');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleCreateRoom() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startingBudget: Number(budget),
          timerDuration: Number(timer) * 60,
          maxTeams: Number(maxTeams),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      sessionStorage.setItem(`facilitator_${data.code}`, data.facilitatorId);
      if (data.facilitatorToken) {
        sessionStorage.setItem(`facilitatorToken_${data.code}`, data.facilitatorToken);
      }
      router.push(`/room/${data.code}/lobby`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create room');
    } finally {
      setLoading(false);
    }
  }

  async function handleJoinRoom() {
    if (!roomCode.trim() || !teamName.trim() || !playerName.trim()) {
      setError('Room code, team name, and player name are required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/rooms/${roomCode.toUpperCase()}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamName: teamName.trim(), playerName: playerName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      sessionStorage.setItem(`team_${data.roomCode}`, JSON.stringify({
        id: data.teamId,
        name: data.teamName,
        color: data.teamColor,
        playerId: data.playerId,
        playerName: data.playerName,
        token: data.token,
      }));
      router.push(`/room/${data.roomCode}/lobby`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to join room');
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

        {mode === 'idle' && (
          <div className="flex flex-col gap-3 w-full">
            <button
              className="btn btn-primary btn-lg w-full text-base shadow-lg"
              onClick={() => setMode('create')}
            >
              Create a room
            </button>
            <button
              className="btn btn-ghost btn-lg w-full text-base"
              onClick={() => setMode('join')}
            >
              Join with a code
            </button>
          </div>
        )}

        {mode === 'create' && (
          <div className="w-full fade-in">
            <div className="glass-card p-5 sm:p-7">
              <h2 className="font-display text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                Room setup
              </h2>
              <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
                Set the stakes. Teams share these rules when they enter the lobby.
              </p>

              <div className="space-y-4">
                <div>
                  <label
                    className="block text-[11px] font-bold uppercase tracking-wider mb-1.5"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Starting budget per team
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
                      onChange={(e) => setBudget(e.target.value)}
                      min="100"
                      max="5000"
                    />
                  </div>
                </div>

                <div>
                  <label
                    className="block text-[11px] font-bold uppercase tracking-wider mb-1.5"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Game duration (minutes)
                  </label>
                  <input
                    type="number"
                    className="input"
                    value={timer}
                    onChange={(e) => setTimer(e.target.value)}
                    min="5"
                    max="60"
                  />
                </div>

                <div>
                  <label
                    className="block text-[11px] font-bold uppercase tracking-wider mb-1.5"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Max teams
                  </label>
                  <input
                    type="number"
                    className="input"
                    value={maxTeams}
                    onChange={(e) => setMaxTeams(e.target.value)}
                    min="2"
                    max="10"
                  />
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

              <div className="flex flex-col sm:flex-row gap-3 mt-7">
                <button
                  className="btn btn-ghost flex-1"
                  onClick={() => {
                    setMode('idle');
                    setError('');
                  }}
                >
                  Back
                </button>
                <button className="btn btn-success flex-1" onClick={handleCreateRoom} disabled={loading}>
                  {loading ? 'Creating…' : 'Create & go to lobby'}
                </button>
              </div>
            </div>
          </div>
        )}

        {mode === 'join' && (
          <div className="w-full fade-in">
            <div className="glass-card p-5 sm:p-7">
              <h2 className="font-display text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                Join a game
              </h2>
              <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
                Enter the five-character code from your host, then pick a team name.
              </p>

              <div className="space-y-4">
                <div>
                  <label
                    className="block text-[11px] font-bold uppercase tracking-wider mb-1.5"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Room code
                  </label>
                  <input
                    type="text"
                    className="input text-center text-2xl font-bold font-mono tracking-[0.35em] uppercase"
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value.toUpperCase().slice(0, 5))}
                    placeholder="•••••"
                    maxLength={5}
                  />
                </div>

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
                    Your name
                  </label>
                  <input
                    type="text"
                    className="input"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    placeholder='e.g. "Alex"'
                    maxLength={20}
                  />
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

              <div className="flex flex-col sm:flex-row gap-3 mt-7">
                <button
                  className="btn btn-ghost flex-1"
                  onClick={() => {
                    setMode('idle');
                    setError('');
                  }}
                >
                  Back
                </button>
                <button className="btn btn-primary flex-1" onClick={handleJoinRoom} disabled={loading}>
                  {loading ? 'Joining…' : 'Enter lobby'}
                </button>
              </div>
            </div>
          </div>
        )}

        <p className="mt-8 sm:mt-10 text-[10px] sm:text-[11px] tracking-wide text-center" style={{ color: 'var(--text-muted)' }}>
          Club event edition · 20–30 minute sessions · Real-time marketplace
        </p>
      </div>
    </div>
  );
}
