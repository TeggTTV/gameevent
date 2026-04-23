import { beforeEach, describe, expect, it, vi } from 'vitest';

const subscribeToRoomMock = vi.fn();
const unsubscribeFromRoomMock = vi.fn();
const getRoomMock = vi.fn();
const getTeamDataMock = vi.fn();
const getLeaderboardMock = vi.fn();
const getRoomEventHistorySinceMock = vi.fn();

const getBearerTokenMock = vi.fn();
const verifyTokenMock = vi.fn();

vi.mock('@/lib/gameState', () => ({
  subscribeToRoom: subscribeToRoomMock,
  unsubscribeFromRoom: unsubscribeFromRoomMock,
  getRoom: getRoomMock,
  getTeamData: getTeamDataMock,
  getLeaderboard: getLeaderboardMock,
  getRoomEventHistorySince: getRoomEventHistorySinceMock,
}));

vi.mock('@/lib/auth', () => ({
  getBearerToken: getBearerTokenMock,
  verifyToken: verifyTokenMock,
}));

async function readInitialChunks(response: Response, maxReads = 3): Promise<string> {
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';

  for (let i = 0; i < maxReads; i += 1) {
    const next = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((resolve) => {
        setTimeout(() => resolve({ done: true, value: undefined }), 20);
      }),
    ]);

    if (next.done || !next.value) break;
    text += decoder.decode(next.value, { stream: true });
  }

  await reader.cancel();
  return text;
}

describe('api route: events SSE', () => {
  beforeEach(() => {
    subscribeToRoomMock.mockReset();
    unsubscribeFromRoomMock.mockReset();
    getRoomMock.mockReset();
    getTeamDataMock.mockReset();
    getLeaderboardMock.mockReset();
    getRoomEventHistorySinceMock.mockReset();
    getBearerTokenMock.mockReset();
    verifyTokenMock.mockReset();

    getRoomMock.mockReturnValue({
      code: 'ABCDE',
      status: 'active',
      teams: [{ id: 'team_1', name: 'Blue Wolves', color: '#ef4444' }],
      marketplace: [],
      endsAt: Date.now() + 10000,
    });
    getLeaderboardMock.mockReturnValue([]);
    getRoomEventHistorySinceMock.mockReturnValue([]);
  });

  it('returns 401 when token is missing/invalid', async () => {
    const { GET } = await import('@/app/api/rooms/[code]/events/route');

    getBearerTokenMock.mockReturnValue(null);
    verifyTokenMock.mockReturnValue(null);

    const req = new Request('http://localhost/api/rooms/abcde/events');
    const res = await GET(req, { params: Promise.resolve({ code: 'abcde' }) });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized session token' });
  });

  it('includes private team data for player tokens', async () => {
    const { GET } = await import('@/app/api/rooms/[code]/events/route');

    verifyTokenMock.mockReturnValue({
      roomCode: 'ABCDE',
      role: 'player',
      teamId: 'team_1',
      exp: Date.now() + 1000,
    });
    getTeamDataMock.mockReturnValue({ id: 'team_1', budget: 500 });

    const req = new Request('http://localhost/api/rooms/abcde/events?token=player-token');
    const res = await GET(req, { params: Promise.resolve({ code: 'abcde' }) });

    expect(res.status).toBe(200);
    const chunk = await readInitialChunks(res);
    expect(chunk).toContain('"type":"connected"');
    expect(chunk).toContain('"team":{"id":"team_1","budget":500}');
  });

  it('keeps targeted replay events visible to facilitator (regression)', async () => {
    const { GET } = await import('@/app/api/rooms/[code]/events/route');

    verifyTokenMock.mockReturnValue({
      roomCode: 'ABCDE',
      role: 'facilitator',
      facilitatorId: 'fac_1',
      exp: Date.now() + 1000,
    });

    getRoomEventHistorySinceMock.mockReturnValue([
      {
        id: 2,
        type: 'scenario-event',
        timestamp: Date.now(),
        data: { targetTeamId: 'team_2', scenarioId: 'sc_1' },
      },
    ]);

    const req = new Request('http://localhost/api/rooms/abcde/events?token=fac-token&sinceEventId=1');
    const res = await GET(req, { params: Promise.resolve({ code: 'abcde' }) });

    expect(res.status).toBe(200);
    const chunk = await readInitialChunks(res);
    expect(chunk).toContain('"targetTeamId":"team_2"');
    expect(chunk).toContain('"scenarioId":"sc_1"');
  });

  it('filters targeted replay events for other teams when viewer is a player', async () => {
    const { GET } = await import('@/app/api/rooms/[code]/events/route');

    verifyTokenMock.mockReturnValue({
      roomCode: 'ABCDE',
      role: 'player',
      teamId: 'team_1',
      exp: Date.now() + 1000,
    });

    getRoomEventHistorySinceMock.mockReturnValue([
      {
        id: 2,
        type: 'scenario-event',
        timestamp: Date.now(),
        data: { targetTeamId: 'team_2', scenarioId: 'sc_1' },
      },
    ]);

    const req = new Request('http://localhost/api/rooms/abcde/events?token=player-token&sinceEventId=1');
    const res = await GET(req, { params: Promise.resolve({ code: 'abcde' }) });

    expect(res.status).toBe(200);
    const chunk = await readInitialChunks(res);
    expect(chunk).not.toContain('"targetTeamId":"team_2"');
  });
});
