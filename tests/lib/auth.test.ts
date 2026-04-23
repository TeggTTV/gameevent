import { describe, expect, it, vi } from 'vitest';

import {
  getBearerToken,
  issueFacilitatorToken,
  issuePlayerToken,
  verifyToken,
} from '@/lib/auth';

describe('lib/auth', () => {
  it('issues and verifies facilitator token', () => {
    const token = issueFacilitatorToken('abc12', 'facilitator_1');
    const claims = verifyToken(token);

    expect(claims).toBeTruthy();
    expect(claims?.role).toBe('facilitator');
    expect(claims?.roomCode).toBe('ABC12');
    expect(claims?.facilitatorId).toBe('facilitator_1');
  });

  it('issues and verifies player token', () => {
    const token = issuePlayerToken('room1', 'team_1', 'player_1');
    const claims = verifyToken(token);

    expect(claims).toBeTruthy();
    expect(claims?.role).toBe('player');
    expect(claims?.roomCode).toBe('ROOM1');
    expect(claims?.teamId).toBe('team_1');
    expect(claims?.playerId).toBe('player_1');
  });

  it('rejects malformed tokens', () => {
    expect(verifyToken('not-a-token')).toBeNull();
    expect(verifyToken('abc.def.ghi')).toBeNull();
  });

  it('rejects tampered payloads', () => {
    const token = issuePlayerToken('room1', 'team_1', 'player_1');
    const [payload, signature] = token.split('.');
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { roomCode: string };
    parsed.roomCode = 'ROOM2';
    const tamperedPayload = Buffer.from(JSON.stringify(parsed), 'utf8').toString('base64url');

    expect(verifyToken(`${tamperedPayload}.${signature}`)).toBeNull();
  });

  it('rejects expired token payloads', () => {
    vi.useFakeTimers();
    const now = new Date('2026-04-23T12:00:00Z');
    vi.setSystemTime(now);

    const token = issuePlayerToken('room1', 'team_1', 'player_1');
    vi.setSystemTime(new Date(now.getTime() + 8 * 60 * 60 * 1000 + 1));

    expect(verifyToken(token)).toBeNull();
    vi.useRealTimers();
  });

  it('extracts bearer token from authorization header', () => {
    const req = new Request('http://localhost/test', {
      headers: { authorization: 'Bearer test-token' },
    });

    expect(getBearerToken(req)).toBe('test-token');
  });

  it('returns null for non-bearer authorization headers', () => {
    const req = new Request('http://localhost/test', {
      headers: { authorization: 'Basic abc123' },
    });

    expect(getBearerToken(req)).toBeNull();
  });
});
