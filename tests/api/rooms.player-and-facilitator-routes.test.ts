import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyTokenMock = vi.fn();
const getBearerTokenMock = vi.fn();

const startGameMock = vi.fn();
const endGameByFacilitatorMock = vi.fn();
const purchaseItemMock = vi.fn();
const listItemMock = vi.fn();
const unlistItemMock = vi.fn();
const getTeamDataMock = vi.fn();
const respondToScenarioMock = vi.fn();
const skipScenarioMock = vi.fn();

vi.mock('@/lib/auth', () => ({
  verifyToken: verifyTokenMock,
  getBearerToken: getBearerTokenMock,
}));

vi.mock('@/lib/gameState', () => ({
  startGame: startGameMock,
  endGameByFacilitator: endGameByFacilitatorMock,
  purchaseItem: purchaseItemMock,
  listItem: listItemMock,
  unlistItem: unlistItemMock,
  getTeamData: getTeamDataMock,
  respondToScenario: respondToScenarioMock,
  skipScenario: skipScenarioMock,
}));

describe('api routes: player and facilitator actions', () => {
  beforeEach(() => {
    verifyTokenMock.mockReset();
    getBearerTokenMock.mockReset();
    startGameMock.mockReset();
    endGameByFacilitatorMock.mockReset();
    purchaseItemMock.mockReset();
    listItemMock.mockReset();
    unlistItemMock.mockReset();
    getTeamDataMock.mockReset();
    respondToScenarioMock.mockReset();
    skipScenarioMock.mockReset();
  });

  it('start route rejects invalid facilitator token', async () => {
    const { POST } = await import('@/app/api/rooms/[code]/start/route');

    getBearerTokenMock.mockReturnValue('bad-token');
    verifyTokenMock.mockReturnValue(null);

    const req = new Request('http://localhost/api/rooms/abcde/start', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ code: 'abcde' }) });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized facilitator token' });
  });

  it('start route starts game with facilitator claim', async () => {
    const { POST } = await import('@/app/api/rooms/[code]/start/route');

    getBearerTokenMock.mockReturnValue('fac-token');
    verifyTokenMock.mockReturnValue({
      roomCode: 'ABCDE',
      role: 'facilitator',
      facilitatorId: 'fac_1',
      exp: Date.now() + 1000,
    });
    startGameMock.mockReturnValue({ room: { status: 'active', endsAt: 12345 } });

    const req = new Request('http://localhost/api/rooms/abcde/start', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ code: 'abcde' }) });

    expect(res.status).toBe(200);
    expect(startGameMock).toHaveBeenCalledWith('abcde', 'fac_1');
    expect(await res.json()).toEqual({ status: 'active', endsAt: 12345 });
  });

  it('buy route rejects unauthorized player', async () => {
    const { POST } = await import('@/app/api/rooms/[code]/buy/route');

    getBearerTokenMock.mockReturnValue('token');
    verifyTokenMock.mockReturnValue({ roomCode: 'ABCDE', role: 'facilitator' });

    const req = new Request('http://localhost/api/rooms/abcde/buy', {
      method: 'POST',
      body: JSON.stringify({ listingId: 'l1' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req, { params: Promise.resolve({ code: 'abcde' }) });
    expect(res.status).toBe(401);
  });

  it('buy route calls purchaseItem for valid player token', async () => {
    const { POST } = await import('@/app/api/rooms/[code]/buy/route');

    getBearerTokenMock.mockReturnValue('player-token');
    verifyTokenMock.mockReturnValue({
      roomCode: 'ABCDE',
      role: 'player',
      teamId: 'team_1',
      exp: Date.now() + 1000,
    });
    purchaseItemMock.mockReturnValue({ team: { id: 'team_1', budget: 400 } });

    const req = new Request('http://localhost/api/rooms/abcde/buy', {
      method: 'POST',
      body: JSON.stringify({ listingId: 'listing_1' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req, { params: Promise.resolve({ code: 'abcde' }) });

    expect(res.status).toBe(200);
    expect(purchaseItemMock).toHaveBeenCalledWith('abcde', 'team_1', 'listing_1', undefined);
  });

  it('list route validates asking price', async () => {
    const { POST } = await import('@/app/api/rooms/[code]/list/route');

    getBearerTokenMock.mockReturnValue('player-token');
    verifyTokenMock.mockReturnValue({
      roomCode: 'ABCDE',
      role: 'player',
      teamId: 'team_1',
      exp: Date.now() + 1000,
    });

    const req = new Request('http://localhost/api/rooms/abcde/list', {
      method: 'POST',
      body: JSON.stringify({ itemId: 'item_1', askingPrice: 0 }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req, { params: Promise.resolve({ code: 'abcde' }) });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'askingPrice must be a valid number above $0' });
  });

  it('unlist route returns full team data on success', async () => {
    const { POST } = await import('@/app/api/rooms/[code]/unlist/route');

    getBearerTokenMock.mockReturnValue('player-token');
    verifyTokenMock.mockReturnValue({
      roomCode: 'ABCDE',
      role: 'player',
      teamId: 'team_1',
      exp: Date.now() + 1000,
    });
    unlistItemMock.mockReturnValue({ team: { id: 'team_1' } });
    getTeamDataMock.mockReturnValue({ id: 'team_1', budget: 500, inventory: [] });

    const req = new Request('http://localhost/api/rooms/abcde/unlist', {
      method: 'POST',
      body: JSON.stringify({ listingId: 'listing_1' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req, { params: Promise.resolve({ code: 'abcde' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.team.id).toBe('team_1');
  });

  it('scenario route supports skip path', async () => {
    const { POST } = await import('@/app/api/rooms/[code]/scenario/route');

    getBearerTokenMock.mockReturnValue('player-token');
    verifyTokenMock.mockReturnValue({
      roomCode: 'ABCDE',
      role: 'player',
      teamId: 'team_1',
      playerId: 'player_1',
      exp: Date.now() + 1000,
    });
    skipScenarioMock.mockReturnValue({
      status: 'skipped',
      outcome: { outcomeText: 'Skipped' },
      team: { id: 'team_1', budget: 450 },
    });

    const req = new Request('http://localhost/api/rooms/abcde/scenario', {
      method: 'POST',
      body: JSON.stringify({ scenarioId: 'sc_1', skip: true }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req, { params: Promise.resolve({ code: 'abcde' }) });

    expect(res.status).toBe(200);
    expect(skipScenarioMock).toHaveBeenCalledWith('abcde', 'team_1', 'player_1', 'sc_1');
  });

  it('end route requires facilitator claim and ends game', async () => {
    const { POST } = await import('@/app/api/rooms/[code]/end/route');

    getBearerTokenMock.mockReturnValue('fac-token');
    verifyTokenMock.mockReturnValue({
      roomCode: 'ABCDE',
      role: 'facilitator',
      facilitatorId: 'fac_1',
      exp: Date.now() + 1000,
    });
    endGameByFacilitatorMock.mockReturnValue({ room: { status: 'ended' } });

    const req = new Request('http://localhost/api/rooms/abcde/end', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ code: 'abcde' }) });

    expect(res.status).toBe(200);
    expect(endGameByFacilitatorMock).toHaveBeenCalledWith('abcde', 'fac_1');
    expect(await res.json()).toEqual({ status: 'ended' });
  });
});
