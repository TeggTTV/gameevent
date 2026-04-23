'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { use } from 'react';

// ===== Types (client-side) =====
interface Item {
  id: string; name: string; category: string;
  rarity: string; condition: string;
  basePrice: number; marketPrice: number;
  purchasePrice?: number;
}
interface Listing {
  id: string; item: Item; askingPrice: number;
  sellerId: string; sellerName: string;
  listedAt: number; locked?: boolean; lockedUntil?: number;
  rejectedBidders?: string[];
}
interface SaleRecord {
  id: string; item: Item; soldPrice: number;
  buyerId: string; buyerName: string;
  sellerId: string; sellerName: string;
  profit: number; timestamp: number;
}
interface ScenarioOption { label: string; description: string; }
interface Scenario {
  id: string; type: string; title: string; description: string;
  options: ScenarioOption[]; expiresAt: number;
  resolved: boolean; chosenOption?: number; outcomeText?: string;
  votes?: Record<string, number>;
}
interface Player { id: string; name: string; }
interface Team {
  id: string; name: string; color: string; budget: number;
  inventory: Item[]; activeListings: Listing[];
  salesHistory: SaleRecord[]; scenarios: Scenario[];
  scenarioSkipsRemaining: number;
  totalSpent: number; totalRevenue: number;
  players?: Player[];
}
interface LeaderboardEntry {
  teamId: string; teamName: string; teamColor: string;
  netProfit: number; itemsSold: number; rank: number;
}
interface PostGameStat {
  teamId: string; teamName: string; teamColor: string;
  netProfit: number; itemsBought: number; itemsSold: number;
  bestSale: { itemName: string; profit: number; soldPrice: number } | null;
  scenariosReceived: number; scenariosAnswered: number;
}
interface ActivityLogEntry {
  id: string; message: string; variant: 'info' | 'warning' | 'danger' | 'success';
  timestamp: number;
}

interface TeamSession {
  id: string;
  name: string;
  color: string;
  playerId: string;
  playerName: string;
  token: string;
}

const CONDITION_LABELS: Record<string, string> = { S: 'Mint', A: 'Great', B: 'Good', C: 'Fair' };
const RARITY_COLORS: Record<string, string> = {
  Common: '#9ca3af',
  Uncommon: '#2dd4bf',
  Rare: '#c084fc',
  Legendary: '#fbbf24',
};

const REWARD_TIERS = [
  { name: 'Bronze', target: 120, color: '#b45309' },
  { name: 'Silver', target: 220, color: '#6b7280' },
  { name: 'Gold', target: 320, color: '#ca8a04' },
];

function parseTeamSession(raw: string | null): Partial<TeamSession> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Partial<TeamSession> : {};
  } catch {
    return {};
  }
}

export default function PlayPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();

  // State
  const [tab, setTab] = useState<'market' | 'dashboard'>('market');
  const [team, setTeam] = useState<Team | null>(null);
  const [marketplace, setMarketplace] = useState<Listing[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState<string>('');
  const [gameOver, setGameOver] = useState(false);
  const [postGameStats, setPostGameStats] = useState<PostGameStat[]>([]);
  const [notifications, setNotifications] = useState<string[]>([]);
  const [listingPrice, setListingPrice] = useState<Record<string, string>>({});
  const [showScenario, setShowScenario] = useState<Scenario | null>(null);
  const [pendingScenarios, setPendingScenarios] = useState<Scenario[]>([]);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'reconnecting' | 'disconnected'>('reconnecting');

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttemptRef = useRef(0);
  const lastEventIdRef = useRef<number>(0);
  const tabRef = useRef(tab);
  const [teamInfo, setTeamInfo] = useState<Partial<TeamSession>>({});
  const [facilitatorToken, setFacilitatorToken] = useState<string | null>(null);
  const isFacilitator = !!facilitatorToken;
  const playerToken = teamInfo.token ?? null;
  const eventStreamToken = playerToken ?? facilitatorToken;
  const viewerKey = teamInfo.id ?? (isFacilitator ? 'facilitator' : null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setTeamInfo(parseTeamSession(sessionStorage.getItem(`team_${code}`)));
    setFacilitatorToken(sessionStorage.getItem(`facilitatorToken_${code}`));
  }, [code]);

  // Keep tabRef in sync
  useEffect(() => { tabRef.current = tab; }, [tab]);

  const addNotification = useCallback((msg: string) => {
    setNotifications(prev => [...prev.slice(-4), msg]);
    setTimeout(() => {
      setNotifications(prev => prev.slice(1));
    }, 4000);
  }, []);

  const addActivityLog = useCallback((message: string, variant: ActivityLogEntry['variant']) => {
    setActivityLog(prev => [...prev.slice(-49), {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      message,
      variant,
      timestamp: Date.now(),
    }]);
  }, []);

  // Show queued scenarios when switching to dashboard
  useEffect(() => {
    if (tab === 'dashboard' && pendingScenarios.length > 0 && !showScenario) {
      const next = pendingScenarios[0];
      setShowScenario(next);
      setPendingScenarios(prev => prev.slice(1));
    }
  }, [tab, pendingScenarios, showScenario]);

  useEffect(() => {
    if (!viewerKey || typeof window === 'undefined') return;
    const key = `lastEvent_${code}_${viewerKey}`;
    const persisted = Number(window.localStorage.getItem(key) || '0');
    if (Number.isFinite(persisted) && persisted > 0) {
      lastEventIdRef.current = persisted;
    }
  }, [code, viewerKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.innerWidth >= 1024) {
      setShowLeaderboard(true);
    }
  }, []);

  const refreshTeam = useCallback(async () => {
    if (!eventStreamToken) return;
    try {
      const query = new URLSearchParams({ token: eventStreamToken });
      const es = new EventSource(`/api/rooms/${code}/events?${query.toString()}`);
      es.onmessage = (event) => {
        const parsed = JSON.parse(event.data);
        if (parsed.type === 'connected') {
          setMarketplace(parsed.data.marketplace || []);
          setLeaderboard(parsed.data.leaderboard || []);
          setEndsAt(parsed.data.endsAt || null);
          setTeam(parsed.data.team || null);
          if (parsed.data.roomStatus === 'ended') setGameOver(true);
          es.close();
        }
      };
      setTimeout(() => es.close(), 2000);
    } catch {
      // ignore fallback refresh failures
    }
  }, [code, eventStreamToken]);

  // SSE connection with reconnect
  useEffect(() => {
    if (!eventStreamToken) return;

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closedByCleanup = false;

    const connect = () => {
      setConnectionStatus(reconnectAttemptRef.current === 0 ? 'reconnecting' : 'disconnected');
      const since = lastEventIdRef.current;
      const query = new URLSearchParams({ token: eventStreamToken });
      if (since > 0) {
        query.set('sinceEventId', String(since));
      }
      const es = new EventSource(`/api/rooms/${code}/events?${query.toString()}`);
      eventSourceRef.current = es;

      es.onopen = () => {
        reconnectAttemptRef.current = 0;
        setConnectionStatus('connected');
      };

      es.onmessage = (event) => {
        const parsed = JSON.parse(event.data);
        if (typeof parsed.id === 'number' && Number.isFinite(parsed.id)) {
          lastEventIdRef.current = parsed.id;
          if (typeof window !== 'undefined' && viewerKey) {
            window.localStorage.setItem(`lastEvent_${code}_${viewerKey}`, String(parsed.id));
          }
        }
        const { type, data } = parsed;

        switch (type) {
          case 'connected':
            setMarketplace(data.marketplace || []);
            setLeaderboard(data.leaderboard || []);
            setEndsAt(data.endsAt || null);
            setTeam(data.team || null);
            break;
          case 'marketplace-update':
            setMarketplace(data.marketplace || []);
            break;
          case 'leaderboard-update':
            setLeaderboard(data.leaderboard || []);
            break;
          case 'item-purchased':
            setMarketplace(data.marketplace || []);
            setLeaderboard(data.leaderboard || []);
            break;
          case 'sale-completed':
            if (data.team) setTeam(data.team);
            if (data.sale) {
              addNotification(`💰 "${data.sale.item.name}" sold for $${data.sale.soldPrice}!`);
            }
            break;
          case 'scenario-event':
          case 'undercut-alert': {
            const scenario = data.scenario;
            if (scenario && !scenario.resolved) {
              if (tabRef.current === 'dashboard') {
                setShowScenario(scenario);
              } else {
                setPendingScenarios(prev => [...prev, scenario]);
                addNotification('⚡ New scenario waiting! Switch to Dashboard to respond.');
              }
            }
            if (data.team) setTeam(data.team);
            break;
          }
          case 'activity-log':
            if (data.message) {
              addActivityLog(data.message, data.variant || 'info');
            }
            break;
          case 'game-started':
            setEndsAt(data.endsAt);
            setMarketplace(data.marketplace || []);
            break;
          case 'game-over':
            setGameOver(true);
            setPostGameStats(data.postGameStats || []);
            setLeaderboard(data.leaderboard || []);
            break;
        }
      };

      es.onerror = () => {
        if (closedByCleanup) return;
        try { es.close(); } catch { /* ignore */ }
        reconnectAttemptRef.current += 1;
        setConnectionStatus('reconnecting');
        const backoffMs = Math.min(10_000, 1000 * 2 ** Math.min(reconnectAttemptRef.current, 4));
        reconnectTimer = setTimeout(connect, backoffMs);
      };
    };

    connect();

    return () => {
      closedByCleanup = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (eventSourceRef.current) {
        try { eventSourceRef.current.close(); } catch { /* ignore */ }
      }
    };
  }, [code, eventStreamToken, viewerKey, addNotification, addActivityLog]);

  // Fallback sync while reconnecting
  useEffect(() => {
    if (!eventStreamToken || connectionStatus === 'connected') return;
    const interval = setInterval(() => {
      refreshTeam();
    }, 7000);
    return () => clearInterval(interval);
  }, [eventStreamToken, connectionStatus, refreshTeam]);

  // Timer countdown
  useEffect(() => {
    if (!endsAt) return;
    const tick = () => {
      const remaining = Math.max(0, endsAt - Date.now());
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      setTimeLeft(`${mins}:${secs.toString().padStart(2, '0')}`);
      if (remaining <= 0) setGameOver(true);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [endsAt]);

  // ===== Actions =====
  async function handleBuy(listingId: string, offerPrice?: number) {
    if (!playerToken) {
      addNotification('Observer mode only. Join a team to buy items.');
      return;
    }
    setBuyingId(listingId);
    try {
      const res = await fetch(`/api/rooms/${code}/buy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${playerToken}`,
        },
        body: JSON.stringify({ listingId, offerPrice }),
      });
      const data = await res.json();
      if (!res.ok) {
        addNotification(`❌ ${data.error}`);
        return;
      }
      if (data.team) setTeam(data.team);
      if (offerPrice) {
        addNotification(`🤝 Offer accepted! Bought for $${offerPrice}.`);
        addActivityLog(`🤝 You successfully bargained for an item at $${offerPrice}!`, 'success');
      } else {
        addNotification(`✅ Item purchased!`);
        addActivityLog('🛒 You bought an item! Head to Dashboard to list it for resale.', 'success');
      }
      refreshTeam();
    } catch {
      addNotification(`❌ Purchase failed`);
    } finally {
      setBuyingId(null);
    }
  }

  async function handleList(itemId: string) {
    if (!playerToken) {
      addNotification('Observer mode only. Join a team to list items.');
      return;
    }
    const price = Number(listingPrice[itemId]);
    if (!price || price <= 0) {
      addNotification('❌ Enter a valid price');
      return;
    }
    try {
      const res = await fetch(`/api/rooms/${code}/list`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${playerToken}`,
        },
        body: JSON.stringify({ itemId, askingPrice: price }),
      });
      const data = await res.json();
      if (!res.ok) {
        addNotification(`❌ ${data.error}`);
        return;
      }
      addNotification(`📋 Item listed for $${price}!`);
      addActivityLog(`📋 You listed an item for $${price}. Watch for customers!`, 'info');
      refreshTeam();
    } catch {
      addNotification(`❌ Listing failed`);
    }
  }

  async function handleUnlist(listingId: string) {
    if (!playerToken) {
      addNotification('Observer mode only. Join a team to unlist items.');
      return;
    }
    try {
      const res = await fetch(`/api/rooms/${code}/unlist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${playerToken}`,
        },
        body: JSON.stringify({ listingId }),
      });
      const data = await res.json();
      if (!res.ok) {
        addNotification(`❌ ${data.error}`);
        return;
      }
      if (data.team) setTeam(data.team);
      addNotification(`↩️ Item unlisted and returned to inventory`);
      refreshTeam();
    } catch {
      addNotification(`❌ Unlist failed`);
    }
  }

  async function handleScenarioResponse(scenarioId: string, optionIndex: number) {
    if (!playerToken) {
      addNotification('Observer mode only. Join a team to answer scenarios.');
      return;
    }
    try {
      const res = await fetch(`/api/rooms/${code}/scenario`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${playerToken}`,
        },
        body: JSON.stringify({ scenarioId, optionIndex }),
      });
      const data = await res.json();
      if (!res.ok) {
        addNotification(`❌ ${data.error}`);
        return;
      }
      if (data.status === 'resolved') {
        addNotification(`📜 ${data.outcomeText}`);
        setShowScenario(null);
      } else {
        addNotification(`⏳ Vote cast! Waiting for teammates.`);
      }
      refreshTeam();
    } catch {
      addNotification(`❌ Failed to respond`);
    }
  }

  async function handleScenarioSkip(scenarioId: string) {
    if (!playerToken) {
      addNotification('Observer mode only. Join a team to skip scenarios.');
      return;
    }
    try {
      const res = await fetch(`/api/rooms/${code}/scenario`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${playerToken}`,
        },
        body: JSON.stringify({ scenarioId, skip: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        addNotification(`❌ ${data.error}`);
        return;
      }
      addNotification(`⏭️ Scenario skipped`);
      setShowScenario(null);
      refreshTeam();
    } catch {
      addNotification('❌ Failed to skip scenario');
    }
  }

  async function handleEndGameEarly() {
    if (!facilitatorToken) return;
    const confirmed = window.confirm('End this game now and show final standings?');
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/rooms/${code}/end`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${facilitatorToken}`,
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        addNotification(`❌ ${data.error}`);
        return;
      }
      addNotification('🛑 Game ended by facilitator');
    } catch {
      addNotification('❌ Failed to end game');
    }
  }

  const timeRemaining = endsAt ? Math.max(0, endsAt - Date.now()) : Infinity;
  const isUrgent = timeRemaining < 120000;
  const netProfit = team ? team.totalRevenue - team.totalSpent : 0;
  const topRewardReached = [...REWARD_TIERS].reverse().find((tier) => netProfit >= tier.target) ?? null;

  // ===== Game Over Screen =====
  if (gameOver) {
    return (
      <div className="app-shell app-shell-inner min-h-screen flex flex-col items-center justify-center px-4 py-10">
        <div className="max-w-2xl w-full text-center fade-in">
          <div className="text-5xl mb-3 drop-shadow-lg">🏆</div>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold mb-2 text-gradient-brand">Game over</h1>
          <p className="text-sm mb-8" style={{ color: 'var(--text-secondary)' }}>Final standings are in. Rack closed.</p>

          {leaderboard.length > 0 && (
            <div className="glass-card p-7 mb-6 text-left sm:text-center">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] mb-4" style={{ color: 'var(--text-muted)' }}>Top team</p>
              <div className="flex items-center justify-center gap-3 mb-2">
                <div className="w-4 h-4 rounded-full ring-2 ring-white/15" style={{ background: leaderboard[0].teamColor }} />
                <span className="font-display text-2xl font-bold">{leaderboard[0].teamName}</span>
              </div>
              <span className="text-xl font-bold font-mono" style={{ color: 'var(--accent-success)' }}>
                ${leaderboard[0].netProfit.toFixed(0)} net profit
              </span>
            </div>
          )}

          <div className="panel mb-6 text-left">
            <div className="panel-header">Reward thresholds</div>
            <div className="space-y-2">
              {REWARD_TIERS.map((tier) => {
                const reached = netProfit >= tier.target;
                return (
                  <div key={tier.name} className="flex items-center justify-between text-sm px-3 py-2 rounded-lg" style={{ background: 'var(--bg-surface)' }}>
                    <span className="font-semibold" style={{ color: reached ? tier.color : 'var(--text-secondary)' }}>
                      {tier.name}
                    </span>
                    <span className="font-mono font-bold">${tier.target}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-xs mt-3" style={{ color: topRewardReached ? 'var(--accent-success)' : 'var(--text-muted)' }}>
              {topRewardReached
                ? `Unlocked: ${topRewardReached.name} tier`
                : `Need $${REWARD_TIERS[0].target - netProfit} more net profit for Bronze`}
            </p>
          </div>

          <div className="panel mb-6 text-left">
            <div className="panel-header">Final leaderboard</div>
            <div className="space-y-2">
              {leaderboard.map((entry) => (
                <div key={entry.teamId} className="flex items-center gap-3 p-3 rounded-xl border"
                  style={{
                    background: entry.rank === 1 ? 'rgba(251, 191, 36, 0.08)' : 'var(--bg-surface)',
                    borderColor: entry.rank === 1 ? 'rgba(251, 191, 36, 0.2)' : 'var(--border-subtle)',
                  }}
                >
                  <span className="text-sm font-bold w-6" style={{ color: 'var(--text-muted)' }}>#{entry.rank}</span>
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ background: entry.teamColor }} />
                  <span className="font-semibold flex-1 text-left text-sm">{entry.teamName}</span>
                  <span className="text-sm font-mono" style={{ color: 'var(--text-secondary)' }}>{entry.itemsSold} sold</span>
                  <span className="font-bold text-sm" style={{ color: entry.netProfit >= 0 ? 'var(--accent-success)' : 'var(--accent-danger)' }}>
                    ${entry.netProfit.toFixed(0)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {postGameStats.length > 0 && (
            <div className="panel mb-6">
              <div className="panel-header">Post-Game Recap</div>
              <div className="space-y-3">
                {postGameStats.map((stat) => (
                  <div key={stat.teamId} className="p-3 rounded-xl text-left" style={{ background: 'var(--bg-surface)' }}>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-3 h-3 rounded-full" style={{ background: stat.teamColor }} />
                      <span className="font-bold text-sm">{stat.teamName}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      <div>📦 {stat.itemsBought} bought</div>
                      <div>💸 {stat.itemsSold} sold</div>
                      <div>⚡ {stat.scenariosAnswered}/{stat.scenariosReceived} scenarios</div>
                    </div>
                    {stat.bestSale && (
                      <div className="mt-2 text-xs">
                        <span style={{ color: 'var(--text-muted)' }}>Best flip: </span>
                        <span style={{ color: 'var(--accent-success)' }}>
                          &quot;{stat.bestSale.itemName}&quot; → ${stat.bestSale.soldPrice} (+${stat.bestSale.profit})
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <button className="btn btn-primary btn-lg shadow-lg" onClick={() => router.push('/')}>
            Back to home
          </button>
        </div>
      </div>
    );
  }

  // ===== Main Game UI =====
  return (
    <div className="app-shell app-shell-inner min-h-screen flex flex-col">
      {/* Top Bar */}
      <header className="app-header flex flex-wrap items-center justify-between gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3.5">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <div className="min-w-0">
            <h1 className="font-display text-base sm:text-xl font-bold tracking-tight truncate">Busy Thrift</h1>
            <p className="text-[10px] uppercase tracking-[0.12em] font-semibold hidden sm:block" style={{ color: 'var(--text-muted)' }}>
              Live floor
            </p>
          </div>
          <div
            className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl border max-w-[200px]"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
          >
            <div className="w-2 h-2 rounded-full shrink-0 ring-2 ring-white/10" style={{ background: teamInfo.color || (isFacilitator ? 'var(--accent-warning)' : 'var(--text-muted)') }} />
            <span className="text-xs font-semibold truncate">{teamInfo.name || (isFacilitator ? 'Facilitator' : 'Unknown')}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-3 ml-auto">
          <div className="hidden sm:flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-lg border"
            style={{
              borderColor: connectionStatus === 'connected' ? 'rgba(34, 197, 94, 0.25)' : 'rgba(245, 158, 11, 0.25)',
              background: connectionStatus === 'connected' ? 'rgba(34, 197, 94, 0.08)' : 'rgba(245, 158, 11, 0.1)',
              color: connectionStatus === 'connected' ? 'var(--accent-success)' : 'var(--accent-warning)',
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: connectionStatus === 'connected' ? 'var(--accent-success)' : 'var(--accent-warning)' }} />
            {connectionStatus === 'connected' ? 'Live' : 'Reconnecting'}
          </div>
          <div className="text-right min-w-[3.75rem] sm:min-w-[4.5rem]">
            <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Budget</div>
            <div className="text-xs sm:text-sm font-bold font-mono tabular-nums" style={{ color: 'var(--accent-success)' }}>
              ${team?.budget?.toFixed(0) ?? '—'}
            </div>
          </div>
          <div className="text-right min-w-[3.75rem] sm:min-w-[4.5rem]">
            <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Net</div>
            <div className="text-xs sm:text-sm font-bold font-mono tabular-nums" style={{ color: netProfit >= 0 ? 'var(--accent-success)' : 'var(--accent-danger)' }}>
              {netProfit >= 0 ? '+' : ''}${netProfit.toFixed(0)}
            </div>
          </div>
          <div
            className={`px-2 sm:px-3 py-1.5 sm:py-2 rounded-xl font-mono font-bold text-xs sm:text-sm border tabular-nums ${isUrgent ? 'timer-urgent' : ''}`}
            style={{
              background: isUrgent ? 'rgba(239, 68, 68, 0.12)' : 'var(--bg-card)',
              borderColor: isUrgent ? 'rgba(239, 68, 68, 0.25)' : 'var(--border-subtle)',
              color: isUrgent ? 'var(--accent-danger)' : 'var(--text-primary)',
            }}
          >
            {timeLeft || '—:——'}
          </div>
          <button
            type="button"
            className="btn btn-ghost px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm rounded-xl"
            onClick={() => setShowLeaderboard(!showLeaderboard)}
            title={showLeaderboard ? 'Hide leaderboard' : 'Show leaderboard'}
          >
            🏆
          </button>
          {isFacilitator && (
            <button
              type="button"
              className="btn btn-ghost hidden sm:inline-flex px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm rounded-xl"
              style={{ borderColor: 'rgba(239, 68, 68, 0.25)', color: 'var(--accent-danger)' }}
              onClick={handleEndGameEarly}
              title="End game early"
            >
              End now
            </button>
          )}
        </div>

        <div className="sm:hidden w-full flex items-center justify-between gap-2 pt-1">
          <div className="inline-flex items-center gap-2 px-2 py-1 rounded-lg border min-w-0"
            style={{
              borderColor: connectionStatus === 'connected' ? 'rgba(34, 197, 94, 0.25)' : 'rgba(245, 158, 11, 0.25)',
              background: connectionStatus === 'connected' ? 'rgba(34, 197, 94, 0.08)' : 'rgba(245, 158, 11, 0.1)',
              color: connectionStatus === 'connected' ? 'var(--accent-success)' : 'var(--accent-warning)',
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: connectionStatus === 'connected' ? 'var(--accent-success)' : 'var(--accent-warning)' }} />
            <span className="text-[10px] font-semibold">{connectionStatus === 'connected' ? 'Live' : 'Reconnecting'}</span>
          </div>
          <div className="inline-flex items-center gap-2 px-2 py-1 rounded-lg border min-w-0"
            style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card)' }}
          >
            <div className="w-2 h-2 rounded-full shrink-0 ring-2 ring-white/10" style={{ background: teamInfo.color || (isFacilitator ? 'var(--accent-warning)' : 'var(--text-muted)') }} />
            <span className="text-[11px] font-semibold truncate max-w-[130px]">{teamInfo.name || (isFacilitator ? 'Facilitator' : 'Unknown')}</span>
          </div>
        </div>

        {isFacilitator && (
          <button
            type="button"
            className="sm:hidden btn btn-ghost w-full mt-1 text-xs rounded-xl"
            style={{ borderColor: 'rgba(239, 68, 68, 0.25)', color: 'var(--accent-danger)' }}
            onClick={handleEndGameEarly}
            title="End game early"
          >
            End game now
          </button>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tab Bar */}
          <div className="flex gap-2 p-2 sm:p-2.5 border-b" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <button
              type="button"
              className={`tab-pill flex-1 py-3 rounded-xl text-sm font-semibold ${tab === 'market' ? 'tab-active' : ''}`}
              style={tab !== 'market' ? { color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.03)' } : {}}
              onClick={() => setTab('market')}
            >
              🏪 Thrifting
              {marketplace.length > 0 && (
                <span className="ml-1.5 text-xs opacity-80">({marketplace.length})</span>
              )}
            </button>
            <button
              type="button"
              className={`tab-pill flex-1 py-3 rounded-xl text-sm font-semibold relative ${tab === 'dashboard' ? 'tab-active' : ''}`}
              style={tab !== 'dashboard' ? { color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.03)' } : {}}
              onClick={() => setTab('dashboard')}
            >
              📊 Dashboard
              {pendingScenarios.length > 0 && (
                <span
                  className="ml-1.5 px-1.5 py-0.5 text-[10px] rounded-full font-bold align-middle"
                  style={{ background: 'var(--accent-danger)', color: 'white' }}
                >
                  {pendingScenarios.length}
                </span>
              )}
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-4">
            {tab === 'market' ? (
              <MarketplaceView
                marketplace={marketplace}
                teamId={teamInfo.id ?? ''}
                budget={team?.budget ?? 0}
                onBuy={handleBuy}
                buyingId={buyingId}
              />
            ) : (
              <DashboardView
                team={team}
                observerMode={isFacilitator && !teamInfo.id}
                listingPrice={listingPrice}
                onSetPrice={(id, price) => setListingPrice(prev => ({ ...prev, [id]: price }))}
                onList={handleList}
                onUnlist={handleUnlist}
              />
            )}
          </div>

          {/* Activity Log at bottom */}
          <ActivityLogPanel entries={activityLog} />
        </div>

        {/* Leaderboard sidebar */}
        {showLeaderboard && (
          <div
            className="w-60 border-l overflow-y-auto p-4 hidden lg:block shrink-0"
            style={{
              borderColor: 'var(--border-subtle)',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.98), rgba(250,248,245,0.98))',
            }}
          >
            <div className="panel-header font-display">🏆 Leaderboard</div>
            <div className="space-y-1.5">
              {leaderboard.map((entry) => (
                <div key={entry.teamId}
                  className="flex items-center gap-2 p-2.5 rounded-xl text-xs border transition-colors"
                  style={{
                    background: entry.teamId === teamInfo.id ? 'rgba(234, 88, 12, 0.1)' : 'transparent',
                    borderColor: entry.teamId === teamInfo.id ? 'rgba(234, 88, 12, 0.28)' : 'transparent',
                  }}
                >
                  <span className="font-bold w-4" style={{ color: 'var(--text-muted)' }}>
                    {entry.rank === 1 ? '👑' : `#${entry.rank}`}
                  </span>
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: entry.teamColor }} />
                  <span className="font-semibold flex-1 truncate">{entry.teamName}</span>
                  <span className="font-mono font-bold"
                    style={{ color: entry.netProfit >= 0 ? 'var(--accent-success)' : 'var(--accent-danger)' }}>
                    ${entry.netProfit.toFixed(0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showLeaderboard && (
        <div className="lg:hidden fixed inset-0 z-40 flex items-end">
          <button
            type="button"
            className="absolute inset-0"
            style={{ background: 'rgba(8, 7, 6, 0.45)' }}
            onClick={() => setShowLeaderboard(false)}
            aria-label="Close leaderboard"
          />
          <div
            className="relative w-full rounded-t-2xl border-t max-h-[62vh] overflow-y-auto p-4 pb-[calc(16px+env(safe-area-inset-bottom))]"
            style={{
              borderColor: 'var(--border-subtle)',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.99), rgba(250,248,245,0.99))',
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="panel-header font-display !mb-0">🏆 Leaderboard</div>
              <button
                type="button"
                className="btn btn-ghost px-2 py-1 text-xs"
                onClick={() => setShowLeaderboard(false)}
              >
                Close
              </button>
            </div>
            <div className="space-y-1.5">
              {leaderboard.map((entry) => (
                <div key={entry.teamId}
                  className="flex items-center gap-2 p-2.5 rounded-xl text-xs border transition-colors"
                  style={{
                    background: entry.teamId === teamInfo.id ? 'rgba(234, 88, 12, 0.1)' : 'transparent',
                    borderColor: entry.teamId === teamInfo.id ? 'rgba(234, 88, 12, 0.28)' : 'transparent',
                  }}
                >
                  <span className="font-bold w-4" style={{ color: 'var(--text-muted)' }}>
                    {entry.rank === 1 ? '👑' : `#${entry.rank}`}
                  </span>
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: entry.teamColor }} />
                  <span className="font-semibold flex-1 truncate">{entry.teamName}</span>
                  <span className="font-mono font-bold"
                    style={{ color: entry.netProfit >= 0 ? 'var(--accent-success)' : 'var(--accent-danger)' }}>
                    ${entry.netProfit.toFixed(0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Notifications */}
      <div className="fixed bottom-3 sm:bottom-4 left-3 right-3 sm:left-auto sm:right-4 z-50 space-y-2 max-w-sm sm:max-w-sm pointer-events-none sm:ml-auto">
        {notifications.map((msg, i) => (
          <div
            key={i}
            className="glass-card px-4 py-3 text-sm notification-enter border pointer-events-auto"
            style={{ background: 'rgba(255, 255, 255, 0.94)', borderColor: 'var(--border-default)' }}
          >
            {msg}
          </div>
        ))}
      </div>

      {/* Scenario Modal — only shows on dashboard tab */}
      {showScenario && !showScenario.resolved && tab === 'dashboard' && (
        <ScenarioModal
          scenario={showScenario}
          team={team}
          playerId={teamInfo.playerId}
          onRespond={(optionIndex) => handleScenarioResponse(showScenario.id, optionIndex)}
          onSkip={() => handleScenarioSkip(showScenario.id)}
          skipEnabled={(team?.scenarioSkipsRemaining ?? 0) > 0}
          skipRemaining={team?.scenarioSkipsRemaining ?? 0}
          onClose={() => setShowScenario(null)}
        />
      )}
    </div>
  );
}

// ===== Activity Log Panel (bottom of page) =====
function ActivityLogPanel({ entries }: { entries: ActivityLogEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  const variantColors: Record<string, string> = {
    info: 'var(--accent-info)',
    warning: 'var(--accent-warning)',
    danger: 'var(--accent-danger)',
    success: 'var(--accent-success)',
  };

  return (
    <div className="border-t" style={{ borderColor: 'var(--border-subtle)', background: 'linear-gradient(180deg, rgba(255,255,255,0.95), rgba(250,248,245,0.98))' }}>
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>
          📜 Activity log
        </span>
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {entries.length} events
        </span>
      </div>
      <div ref={scrollRef} className="h-24 sm:h-32 overflow-y-auto px-4 pb-2 space-y-0.5">
        {entries.length === 0 ? (
          <p className="text-[10px] py-2" style={{ color: 'var(--text-muted)' }}>
            Waiting for activity... Buy and list items to see customer feedback here.
          </p>
        ) : (
          entries.map(entry => (
            <div key={entry.id} className="flex items-start gap-2 py-0.5">
              <span className="text-[9px] font-mono shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <div className="w-1.5 h-1.5 rounded-full shrink-0 mt-1" style={{ background: variantColors[entry.variant] }} />
              <span className="text-[11px] leading-tight" style={{ color: entry.variant === 'danger' ? 'var(--accent-danger)' : entry.variant === 'warning' ? 'var(--accent-warning)' : 'var(--text-secondary)' }}>
                {entry.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ===== Marketplace Component =====
function MarketplaceView({
  marketplace, teamId, budget, onBuy, buyingId
}: {
  marketplace: Listing[]; teamId: string; budget: number;
  onBuy: (id: string, offer?: number) => void; buyingId: string | null;
}) {
  const rarityOrder: Record<string, number> = { Legendary: 0, Rare: 1, Uncommon: 2, Common: 3 };
  const sorted = [...marketplace].sort((a, b) => {
    const aIsOwn = a.sellerId === teamId;
    const bIsOwn = b.sellerId === teamId;
    if (aIsOwn !== bIsOwn) return aIsOwn ? 1 : -1;
    return (rarityOrder[a.item.rarity] ?? 4) - (rarityOrder[b.item.rarity] ?? 4);
  });

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 mb-5">
        <div>
          <h2 className="font-display text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            Marketplace
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Store stock rotates; player listings appear here too.
          </p>
        </div>
        <span className="text-[11px] font-mono shrink-0 px-2 py-1 rounded-lg border" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
          {marketplace.length} items · +5s restock
        </span>
      </div>

      {sorted.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border border-dashed" style={{ borderColor: 'var(--border-default)' }}>
          <div className="text-4xl mb-3 opacity-80">🏪</div>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Floor is quiet. New pieces are being tagged…</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 min-[360px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2">
          {sorted.map((listing) => (
            <ItemCard
              key={listing.id}
              listing={listing}
              teamId={teamId}
              budget={budget}
              isOwn={listing.sellerId === teamId}
              isBuying={buyingId === listing.id}
              onBuy={(offer) => onBuy(listing.id, offer)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ===== Item Card Component (Change #2: show market value) =====
function ItemCard({
  listing, teamId, budget, isOwn, isBuying, onBuy
}: {
  listing: Listing; teamId: string; budget: number; isOwn: boolean;
  isBuying: boolean; onBuy: (offer?: number) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [isBargaining, setIsBargaining] = useState(false);
  const [offerPct, setOfferPct] = useState(80);
  const offer = Math.max(1, Math.round(listing.askingPrice * (offerPct / 100)));

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const { item } = listing;
  const rarityClass = `rarity-${item.rarity.toLowerCase()}`;
  const badgeClass = `badge-${item.rarity.toLowerCase()}`;
  const condClass = `condition-${item.condition.toLowerCase()}`;
  const isStore = listing.sellerId === '__store__';
  const isLocked = !!(listing.locked && listing.lockedUntil && now && listing.lockedUntil > now);
  const isRejected = listing.rejectedBidders?.includes(teamId);
  const canAffordFull = budget >= listing.askingPrice;
  const canAffordOffer = budget >= offer;

  // Calculate value indicator
  const priceDiff = listing.askingPrice - item.marketPrice;
  const pricePct = ((listing.askingPrice / item.marketPrice) - 1) * 100;
  const isDeal = priceDiff < 0;
  const isFair = Math.abs(pricePct) <= 10;

  // Calculate bargaining chance
  const ratio = offer / listing.askingPrice;
  let chance = 0;
  if (ratio >= 1.0) chance = 100;
  else if (ratio <= 0.3) chance = 0;
  else chance = Math.round(((ratio - 0.3) / 0.7) * 100);

  return (
    <div className={`item-card p-3 flex flex-col border-l-2 ${rarityClass} h-full`}
    >
      
      {/* Top area: Badges & Seller */}
      <div className="flex items-start justify-between mb-2 gap-2">
        <div className="flex flex-col gap-1 items-start shrink-0">
          <span className={`text-[9px] font-bold uppercase px-1 py-0.5 rounded ${badgeClass}`}>
            {item.rarity}
          </span>
          <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${condClass}`}>
            {item.condition} · {CONDITION_LABELS[item.condition]}
          </span>
        </div>
        
        {/* Price Tag Prominently at Top Right */}
        <div className="text-right min-w-0">
          <div className="text-xl font-black font-mono leading-none truncate" style={{ color: RARITY_COLORS[item.rarity] }}>
            ${listing.askingPrice}
          </div>
          <div className="text-[9px] mt-1 truncate" style={{ color: 'var(--text-muted)' }}>
            {isStore ? '🏪 Thrift Store' : `📋 ${listing.sellerName}`}
          </div>
        </div>
      </div>

      {/* Item info */}
      <div className="flex-1 mb-2">
        <h3 className="text-sm font-bold leading-tight line-clamp-2" title={item.name}>{item.name}</h3>
        <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{item.category}</p>
      </div>

      {/* Market Value hint (compact) */}
      <div className="flex items-center justify-between mt-auto mb-2 px-1.5 py-1 rounded" style={{ background: 'var(--bg-card)' }}>
        <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>Value: <span className="font-mono font-bold" style={{ color: 'var(--text-secondary)' }}>${item.marketPrice}</span></span>
        {!isStore && (
          <span className="text-[9px] font-bold" style={{
            color: isDeal ? 'var(--accent-success)' : isFair ? 'var(--accent-info)' : 'var(--accent-warning)'
          }}>
            {isDeal ? '🔥 Deal' : isFair ? '✓ Fair' : `+${pricePct.toFixed(0)}%`}
          </span>
        )}
      </div>

      {/* Full-width Buy button */}
      <div className="pt-2 mt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
        {isOwn ? (
          <div className="text-center text-[10px] py-1.5 rounded-lg font-bold border" style={{ background: 'rgba(234, 88, 12, 0.1)', color: 'var(--accent-primary)', borderColor: 'rgba(234, 88, 12, 0.2)' }}>
            Your listing
          </div>
        ) : isLocked ? (
          <div className="text-center text-[10px] py-1.5 rounded font-bold" style={{ background: 'rgba(245, 158, 11, 0.1)', color: 'var(--accent-warning)' }}>
            🔒 Locked
          </div>
        ) : isRejected ? (
          <div className="text-center text-[10px] py-1.5 rounded font-bold" style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--accent-danger)' }}>
            Offer Rejected
          </div>
        ) : isBargaining ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold">Offer: ${offer}</span>
              <span className="text-[10px] font-bold" style={{
                color: chance >= 75 ? 'var(--accent-success)' : chance >= 40 ? 'var(--accent-warning)' : 'var(--accent-danger)'
              }}>{chance}% chance</span>
            </div>
            <input
              type="range"
              min={1}
              max={100}
              value={offerPct}
              onChange={(e) => setOfferPct(Number(e.target.value))}
              className="range-bargain w-full cursor-pointer"
            />
            <div className="flex gap-1 mt-1">
              <button 
                className="btn btn-ghost text-[10px] py-1.5 flex-1"
                onClick={() => setIsBargaining(false)}
              >
                Cancel
              </button>
              <button
                className={`btn text-[10px] py-1.5 flex-1 ${canAffordOffer ? 'btn-success' : 'btn-ghost'}`}
                onClick={() => onBuy(offer)}
                disabled={!canAffordOffer || isBuying}
              >
                {isBuying ? '...' : canAffordOffer ? 'Submit' : 'Too poor'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-1">
            <button
              className={`btn text-[11px] py-1.5 flex-2 font-bold ${canAffordFull ? 'btn-success' : 'btn-ghost'}`}
              onClick={() => onBuy()}
              disabled={!canAffordFull || isBuying}
            >
              {isBuying ? '...' : canAffordFull ? 'Buy' : 'Can\'t afford'}
            </button>
            {canAffordFull && (
              <button
                className="btn text-[10px] py-1.5 flex-1 px-1 font-bold whitespace-nowrap"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)' }}
                onClick={() => setIsBargaining(true)}
                disabled={isBuying}
              >
                Negotiate
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ===== Dashboard Component (Changes #1, #5, #7) =====
function DashboardView({
  team, observerMode, listingPrice, onSetPrice, onList, onUnlist
}: {
  team: Team | null;
  observerMode?: boolean;
  listingPrice: Record<string, string>;
  onSetPrice: (id: string, price: string) => void;
  onList: (itemId: string) => void;
  onUnlist: (listingId: string) => void;
}) {
  if (!team) {
    return (
      <div className="text-center py-20 rounded-2xl border border-dashed" style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}>
        <div className="font-display text-lg font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>
          {observerMode ? 'Observer mode' : 'Loading your booth…'}
        </div>
        <p className="text-sm">
          {observerMode ? 'You can monitor the marketplace and leaderboard, but only teams can manage inventory.' : 'Syncing inventory and listings.'}
        </p>
      </div>
    );
  }

  const netProfit = team.totalRevenue - team.totalSpent;
  const inventoryValue = team.inventory.reduce((sum, i) => sum + (i.purchasePrice ?? i.marketPrice), 0);
  const listingsValue = team.activeListings.reduce((sum, l) => sum + l.askingPrice, 0);
  const totalAssets = team.budget + inventoryValue + listingsValue;

  // Chart data calculations
  const totalSalesProfit = team.salesHistory.reduce((sum, s) => sum + s.profit, 0);
  const totalSalesRevenue = team.salesHistory.reduce((sum, s) => sum + s.soldPrice, 0);

  // Category breakdown
  const categoryBreakdown: Record<string, number> = {};
  for (const item of team.inventory) {
    categoryBreakdown[item.category] = (categoryBreakdown[item.category] || 0) + 1;
  }
  for (const listing of team.activeListings) {
    categoryBreakdown[listing.item.category] = (categoryBreakdown[listing.item.category] || 0) + 1;
  }
  const categoryEntries = Object.entries(categoryBreakdown).sort((a, b) => b[1] - a[1]);

  // Rarity breakdown
  const rarityBreakdown: Record<string, number> = {};
  const allItems = [
    ...team.inventory,
    ...team.activeListings.map(l => l.item),
    ...team.salesHistory.map(s => s.item),
  ];
  for (const item of allItems) {
    rarityBreakdown[item.rarity] = (rarityBreakdown[item.rarity] || 0) + 1;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Net Profit Tracker */}
      <div className="panel">
        <div className="panel-header">💰 Net Profit</div>
        <div className="text-3xl font-black font-mono"
          style={{ color: netProfit >= 0 ? 'var(--accent-success)' : 'var(--accent-danger)' }}>
          {netProfit >= 0 ? '+' : ''}${netProfit.toFixed(0)}
        </div>
        <div className="flex gap-4 mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <span>Revenue: ${team.totalRevenue.toFixed(0)}</span>
          <span>Spent: ${team.totalSpent.toFixed(0)}</span>
          <span>Budget: ${team.budget.toFixed(0)}</span>
        </div>
      </div>

      {/* Change #7: Replace scenario inbox with portfolio overview */}
      <div className="panel">
        <div className="panel-header">📈 Portfolio Overview</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="p-2 rounded-lg" style={{ background: 'var(--bg-surface)' }}>
            <div className="text-[10px] uppercase font-semibold" style={{ color: 'var(--text-muted)' }}>Total Assets</div>
            <div className="text-lg font-bold font-mono" style={{ color: 'var(--accent-primary)' }}>
              ${totalAssets.toFixed(0)}
            </div>
          </div>
          <div className="p-2 rounded-lg" style={{ background: 'var(--bg-surface)' }}>
            <div className="text-[10px] uppercase font-semibold" style={{ color: 'var(--text-muted)' }}>Inventory Value</div>
            <div className="text-lg font-bold font-mono" style={{ color: 'var(--accent-info)' }}>
              ${inventoryValue.toFixed(0)}
            </div>
          </div>
          <div className="p-2 rounded-lg" style={{ background: 'var(--bg-surface)' }}>
            <div className="text-[10px] uppercase font-semibold" style={{ color: 'var(--text-muted)' }}>Listed Value</div>
            <div className="text-lg font-bold font-mono" style={{ color: 'var(--accent-warning)' }}>
              ${listingsValue.toFixed(0)}
            </div>
          </div>
          <div className="p-2 rounded-lg" style={{ background: 'var(--bg-surface)' }}>
            <div className="text-[10px] uppercase font-semibold" style={{ color: 'var(--text-muted)' }}>Avg Profit/Sale</div>
            <div className="text-lg font-bold font-mono"
              style={{ color: team.salesHistory.length > 0 ? (totalSalesProfit >= 0 ? 'var(--accent-success)' : 'var(--accent-danger)') : 'var(--text-muted)' }}>
              {team.salesHistory.length > 0 ? `$${(totalSalesProfit / team.salesHistory.length).toFixed(0)}` : '—'}
            </div>
          </div>
        </div>

        {/* Mini bar chart for rarity breakdown */}
        {Object.keys(rarityBreakdown).length > 0 && (
          <div className="mt-3">
            <div className="text-[10px] uppercase font-semibold mb-1.5" style={{ color: 'var(--text-muted)' }}>Item Rarity Breakdown</div>
            <div className="flex gap-1 h-6 rounded-md overflow-hidden">
              {Object.entries(rarityBreakdown).map(([rarity, count]) => {
                const total = allItems.length;
                const width = Math.max(8, (count / total) * 100);
                return (
                  <div key={rarity} className="flex items-center justify-center text-[8px] font-bold"
                    style={{ width: `${width}%`, background: RARITY_COLORS[rarity] + '40', color: RARITY_COLORS[rarity] }}>
                    {count}
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2 mt-1">
              {Object.entries(rarityBreakdown).map(([rarity, count]) => (
                <span key={rarity} className="text-[9px] flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: RARITY_COLORS[rarity] }} />
                  {rarity} ({count})
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Category breakdown */}
        {categoryEntries.length > 0 && (
          <div className="mt-3">
            <div className="text-[10px] uppercase font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Current Holdings by Category</div>
            <div className="flex flex-wrap gap-1">
              {categoryEntries.slice(0, 6).map(([cat, count]) => (
                <span key={cat} className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)' }}>
                  {cat}: {count}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Revenue breakdown mini chart */}
        {totalSalesRevenue > 0 && (
          <div className="mt-3">
            <div className="text-[10px] uppercase font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Revenue Split</div>
            <div className="flex h-4 rounded-md overflow-hidden">
              <div className="flex items-center justify-center text-[8px] font-bold"
                style={{ width: `${Math.max(10, (totalSalesProfit / totalSalesRevenue) * 100)}%`, background: 'rgba(34, 197, 94, 0.3)', color: 'var(--accent-success)' }}>
                Profit
              </div>
              <div className="flex items-center justify-center text-[8px] font-bold"
                style={{ width: `${Math.max(10, ((totalSalesRevenue - totalSalesProfit) / totalSalesRevenue) * 100)}%`, background: 'rgba(239, 68, 68, 0.2)', color: 'var(--accent-danger)' }}>
                Cost
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Inventory (Change #1: show purchase price + % markup) */}
      <div className="panel">
        <div className="panel-header">📦 Inventory ({team.inventory.length})</div>
        {team.inventory.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Empty — go buy some items!</p>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {team.inventory.map(item => {
              const cost = item.purchasePrice ?? item.marketPrice;
              const enteredPrice = Number(listingPrice[item.id]) || 0;
              const pctIncrease = enteredPrice > 0 ? ((enteredPrice / cost) - 1) * 100 : 0;

              return (
                <div key={item.id} className="flex flex-col sm:flex-row sm:items-center gap-2 p-2 rounded-lg" style={{ background: 'var(--bg-surface)' }}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className={`text-[9px] font-bold uppercase px-1 py-0.5 rounded badge-${item.rarity.toLowerCase()}`}>
                        {item.rarity}
                      </span>
                      <span className={`text-[9px] font-bold px-1 py-0.5 rounded condition-${item.condition.toLowerCase()}`}>
                        {item.condition}
                      </span>
                    </div>
                    <div className="text-xs font-semibold truncate mt-0.5">{item.name}</div>
                    <div className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                      Paid: <span style={{ color: 'var(--accent-info)' }}>${cost}</span>
                      <span className="mx-1">·</span>
                      Value: ${item.marketPrice}
                    </div>
                  </div>
                  <div className="flex flex-col sm:items-end gap-0.5">
                    <div className="flex items-center gap-1 w-full sm:w-auto">
                      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>$</span>
                      <input
                        type="number"
                        className="w-full sm:w-16 px-1.5 py-1 rounded text-xs text-right"
                        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                        placeholder={String(Math.round(cost * 1.3))}
                        value={listingPrice[item.id] || ''}
                        onChange={(e) => onSetPrice(item.id, e.target.value)}
                      />
                      <button
                        className="btn btn-primary text-[10px] px-2 py-1"
                        onClick={() => onList(item.id)}
                      >
                        List
                      </button>
                    </div>
                    {/* Show % increase when price is entered */}
                    {enteredPrice > 0 && (
                      <span className="text-[9px] font-bold" style={{
                        color: pctIncrease >= 0 ? 'var(--accent-success)' : 'var(--accent-danger)'
                      }}>
                        {pctIncrease >= 0 ? '↑' : '↓'} {Math.abs(pctIncrease).toFixed(0)}% {pctIncrease >= 0 ? 'markup' : 'loss'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Active Listings (Change #5: unlist button) */}
      <div className="panel">
        <div className="panel-header">📋 Active Listings ({team.activeListings.length})</div>
        {team.activeListings.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No items listed. Buy items and list them for profit!</p>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {team.activeListings.map(listing => {
              const cost = listing.item.purchasePrice ?? listing.item.marketPrice;
              const profitDiff = listing.askingPrice - cost;
              const profitPct = ((listing.askingPrice / cost) - 1) * 100;

              return (
                <div key={listing.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between p-2 rounded-lg" style={{ background: 'var(--bg-surface)' }}>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold">{listing.item.name}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      Paid: ${cost} · Listed: ${listing.askingPrice}
                      <span className="ml-1 font-bold" style={{ color: profitDiff >= 0 ? 'var(--accent-success)' : 'var(--accent-danger)' }}>
                        ({profitPct >= 0 ? '+' : ''}{profitPct.toFixed(0)}%)
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 justify-between sm:justify-end">
                    <span className="text-xs font-bold font-mono"
                      style={{ color: profitDiff >= 0 ? 'var(--accent-success)' : 'var(--accent-danger)' }}>
                      {profitDiff >= 0 ? '+' : ''}${profitDiff.toFixed(0)}
                    </span>
                    <button
                      className="text-[10px] px-2 py-1 rounded-md transition-all hover:bg-red-500/20"
                      style={{ color: 'var(--accent-danger)', border: '1px solid rgba(239, 68, 68, 0.2)' }}
                      onClick={() => onUnlist(listing.id)}
                      title="Unlist and return to inventory"
                    >
                      ✕ Unlist
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sales History */}
      <div className="panel lg:col-span-2">
        <div className="panel-header">💸 Sales History ({team.salesHistory.length})</div>
        {team.salesHistory.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No sales yet. List items and wait for buyers!</p>
        ) : (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {[...team.salesHistory].reverse().map(sale => (
              <div key={sale.id} className="flex items-center justify-between p-2 rounded-lg text-xs" style={{ background: 'var(--bg-surface)' }}>
                <div>
                  <span className="font-semibold">{sale.item.name}</span>
                  <span className="ml-2" style={{ color: 'var(--text-muted)' }}>→ {sale.buyerName}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>${sale.soldPrice}</span>
                  <span className="font-bold font-mono"
                    style={{ color: sale.profit >= 0 ? 'var(--accent-success)' : 'var(--accent-danger)' }}>
                    {sale.profit >= 0 ? '+' : ''}${sale.profit.toFixed(0)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ===== Scenario Modal =====
function ScenarioModal({
  scenario, team, playerId, onRespond, onSkip, skipEnabled, skipRemaining, onClose
}: {
  scenario: Scenario;
  team: Team | null;
  playerId?: string;
  onRespond: (optionIndex: number) => void;
  onSkip: () => void;
  skipEnabled: boolean;
  skipRemaining: number;
  onClose: () => void;
}) {
  const [timerLeft, setTimerLeft] = useState('');

  useEffect(() => {
    const tick = () => {
      const remaining = Math.max(0, scenario.expiresAt - Date.now());
      const secs = Math.ceil(remaining / 1000);
      setTimerLeft(`${secs}s`);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [scenario.expiresAt]);

  const votes = scenario.votes || {};
  const myVote = playerId ? votes[playerId] : undefined;
  const hasVoted = myVote !== undefined;

  async function handleChoose(idx: number) {
    if (hasVoted) return;
    onRespond(idx);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-3 sm:px-4 py-5 sm:py-8"
      style={{ background: 'rgba(8, 7, 6, 0.72)', backdropFilter: 'blur(8px)' }}
    >
      <div className="glass-card max-w-md w-full p-4 sm:p-7 fade-in max-h-[90vh] overflow-y-auto" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-strong)' }}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <h2 className="font-display text-lg sm:text-xl font-bold leading-snug pr-2">{scenario.title}</h2>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className="text-xs font-mono px-2.5 py-1 rounded-lg border"
              style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--accent-danger)', borderColor: 'rgba(239, 68, 68, 0.25)' }}
            >
              {timerLeft}
            </span>
            <button type="button" onClick={onClose} className="btn btn-ghost px-2 py-1 text-sm" aria-label="Dismiss">
              ✕
            </button>
          </div>
        </div>

        <p className="text-sm mb-6 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {scenario.description}
        </p>

        <div className="space-y-2.5">
          {scenario.options.map((opt, idx) => {
            const voteCount = Object.values(votes).filter(v => v === idx).length;
            const totalPlayers = team?.players?.length || 1;
            const isMyChoice = myVote === idx;

            return (
              <button
                key={idx}
                type="button"
                className="scenario-option w-full text-left p-3.5 relative"
                onClick={() => handleChoose(idx)}
                disabled={hasVoted}
                style={isMyChoice ? { borderColor: 'var(--accent-primary)', background: 'rgba(234, 88, 12, 0.07)' } : {}}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="text-[11px] font-extrabold w-6 h-6 flex items-center justify-center rounded-lg border"
                    style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', borderColor: 'var(--border-subtle)' }}
                  >
                    {String.fromCharCode(65 + idx)}
                  </span>
                  <span className="text-sm font-semibold">{opt.label}</span>
                </div>
                <p className="text-xs ml-8 leading-snug" style={{ color: 'var(--text-muted)' }}>
                  {opt.description}
                </p>
                {voteCount > 0 && (
                  <span className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 text-[10px] sm:text-xs font-bold" style={{ color: 'var(--accent-primary)' }}>
                    {voteCount}/{totalPlayers} votes
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-4 pt-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--border-subtle)' }}>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Skips remaining: {skipRemaining}
          </span>
          <button
            type="button"
            className="btn btn-ghost text-xs px-3 py-1.5"
            style={{ borderColor: 'rgba(245, 158, 11, 0.3)', color: 'var(--accent-warning)' }}
            onClick={onSkip}
            disabled={!skipEnabled || hasVoted}
            title={!skipEnabled ? 'No scenario skips remaining' : 'Skip this scenario'}
          >
            Skip scenario
          </button>
        </div>
      </div>
    </div>
  );
}
