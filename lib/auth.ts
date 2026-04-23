import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

type TokenRole = 'facilitator' | 'player';

export interface SessionClaims {
  roomCode: string;
  role: TokenRole;
  facilitatorId?: string;
  teamId?: string;
  playerId?: string;
  exp: number;
}

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

const globalForAuth = globalThis as unknown as {
  devAuthSecret?: string;
};

function getSecret(): string {
  const configuredSecret = process.env.LOCAL_AUTH_SECRET?.trim();
  if (configuredSecret) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('LOCAL_AUTH_SECRET is required in production. Set a strong random secret in your environment.');
  }

  // In local development, use a process-lifetime secret if none is configured.
  if (!globalForAuth.devAuthSecret) {
    globalForAuth.devAuthSecret = randomBytes(32).toString('hex');
  }

  return globalForAuth.devAuthSecret;
}

function base64UrlEncode(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}

function base64UrlDecode(text: string): string {
  return Buffer.from(text, 'base64url').toString('utf8');
}

function sign(payloadPart: string): string {
  return createHmac('sha256', getSecret()).update(payloadPart).digest('base64url');
}

function issueToken(claims: Omit<SessionClaims, 'exp'>): string {
  const payload = {
    ...claims,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(payloadPart);
  return `${payloadPart}.${signature}`;
}

export function issueFacilitatorToken(roomCode: string, facilitatorId: string): string {
  return issueToken({ roomCode: roomCode.toUpperCase(), role: 'facilitator', facilitatorId });
}

export function issuePlayerToken(roomCode: string, teamId: string, playerId: string): string {
  return issueToken({ roomCode: roomCode.toUpperCase(), role: 'player', teamId, playerId });
}

export function verifyToken(token: string): SessionClaims | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadPart, signaturePart] = parts;
  const expected = sign(payloadPart);

  const gotBuf = Buffer.from(signaturePart, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (gotBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(gotBuf, expectedBuf)) return null;

  try {
    const claims = JSON.parse(base64UrlDecode(payloadPart)) as SessionClaims;
    if (!claims || typeof claims !== 'object') return null;
    if (typeof claims.exp !== 'number' || claims.exp < Date.now()) return null;
    if (!claims.roomCode || !claims.role) return null;
    return claims;
  } catch {
    return null;
  }
}

export function getBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}
