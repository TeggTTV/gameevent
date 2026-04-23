import { beforeEach, describe, expect, it, vi } from 'vitest';

const getRoomMock = vi.fn();

vi.mock('@/lib/gameState', () => ({
  getRoom: getRoomMock,
}));

describe('api route: room details', () => {
  beforeEach(() => {
    getRoomMock.mockReset();
  });

  it('returns 404 when room does not exist', async () => {
    const { GET } = await import('@/app/api/rooms/[code]/route');
    getRoomMock.mockReturnValue(undefined);

    const res = await GET(new Request('http://localhost/api/rooms/abcde'), {
      params: Promise.resolve({ code: 'abcde' }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Room not found' });
  });

  it('returns sanitized room metadata', async () => {
    const { GET } = await import('@/app/api/rooms/[code]/route');
    getRoomMock.mockReturnValue({
      code: 'ABCDE',
      status: 'active',
      config: { startingBudget: 500, timerDuration: 1200, maxTeams: 6 },
      teams: [{ id: 'team_1', name: 'Blue Wolves', color: '#ef4444', budget: 500 }],
      startedAt: 100,
      endsAt: 200,
    });

    const res = await GET(new Request('http://localhost/api/rooms/abcde'), {
      params: Promise.resolve({ code: 'abcde' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      code: 'ABCDE',
      status: 'active',
      config: { startingBudget: 500, timerDuration: 1200, maxTeams: 6 },
      teams: [{ id: 'team_1', name: 'Blue Wolves', color: '#ef4444' }],
      startedAt: 100,
      endsAt: 200,
    });
  });
});
