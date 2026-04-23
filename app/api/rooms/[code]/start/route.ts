import { startGame } from '@/lib/gameState';
import { getBearerToken, verifyToken } from '@/lib/auth';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  try {
    const token = getBearerToken(request);
    const claims = token ? verifyToken(token) : null;

    if (!claims || claims.role !== 'facilitator' || claims.roomCode !== code.toUpperCase() || !claims.facilitatorId) {
      return Response.json({ error: 'Unauthorized facilitator token' }, { status: 401 });
    }

    const result = startGame(code, claims.facilitatorId);
    if ('error' in result) {
      return Response.json({ error: result.error }, { status: 400 });
    }

    return Response.json({
      status: result.room.status,
      endsAt: result.room.endsAt,
    });
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }
}
