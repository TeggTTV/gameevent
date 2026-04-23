import { beforeEach, describe, expect, it, vi } from 'vitest';

const createRoomMock = vi.fn();
const joinRoomMock = vi.fn();
const issueFacilitatorTokenMock = vi.fn();
const issuePlayerTokenMock = vi.fn();

vi.mock('@/lib/gameState', () => ({
  createRoom: createRoomMock,
  joinRoom: joinRoomMock,
}));

vi.mock('@/lib/auth', () => ({
  issueFacilitatorToken: issueFacilitatorTokenMock,
  issuePlayerToken: issuePlayerTokenMock,
}));

describe('api routes: create and join room', () => {
  beforeEach(() => {
    createRoomMock.mockReset();
    joinRoomMock.mockReset();
    issueFacilitatorTokenMock.mockReset();
    issuePlayerTokenMock.mockReset();
  });

  it('clamps create-room payload and returns facilitator token', async () => {
    const { POST } = await import('@/app/api/rooms/route');

    createRoomMock.mockReturnValue({
      code: 'ABCDE',
      facilitatorId: 'fac_1',
      config: { startingBudget: 5000, timerDuration: 300, maxTeams: 1 },
    });
    issueFacilitatorTokenMock.mockReturnValue('fac-token');

    const req = new Request('http://localhost/api/rooms', {
      method: 'POST',
      body: JSON.stringify({
        startingBudget: 999999,
        timerDuration: 1,
        maxTeams: -100,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(createRoomMock).toHaveBeenCalledWith(5000, 300, 1);
    expect(body.facilitatorToken).toBe('fac-token');
    expect(body.code).toBe('ABCDE');
  });

  it('returns 400 for missing create-room fields', async () => {
    const { POST } = await import('@/app/api/rooms/route');

    const req = new Request('http://localhost/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ startingBudget: 500 }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Missing required fields' });
  });

  it('returns 400 for missing join names', async () => {
    const { POST } = await import('@/app/api/rooms/[code]/join/route');

    const req = new Request('http://localhost/api/rooms/abcde/join', {
      method: 'POST',
      body: JSON.stringify({ teamName: 'Blue Wolves' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req, { params: Promise.resolve({ code: 'abcde' }) });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Player name is required' });
  });

  it('joins room and returns player token', async () => {
    const { POST } = await import('@/app/api/rooms/[code]/join/route');

    joinRoomMock.mockReturnValue({
      team: { id: 'team_1', name: 'Blue Wolves', color: '#ef4444', budget: 500 },
      player: { id: 'player_1', name: 'Alice' },
      room: {
        code: 'ABCDE',
        teams: [{ id: 'team_1', name: 'Blue Wolves', color: '#ef4444' }],
      },
    });
    issuePlayerTokenMock.mockReturnValue('player-token');

    const req = new Request('http://localhost/api/rooms/abcde/join', {
      method: 'POST',
      body: JSON.stringify({ teamName: 'Blue Wolves', playerName: 'Alice' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req, { params: Promise.resolve({ code: 'abcde' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(joinRoomMock).toHaveBeenCalledWith('abcde', 'Blue Wolves', 'Alice');
    expect(body.token).toBe('player-token');
    expect(body.teamId).toBe('team_1');
    expect(body.roomCode).toBe('ABCDE');
  });
});
