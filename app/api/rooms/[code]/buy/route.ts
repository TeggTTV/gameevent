import { purchaseItem } from '@/lib/gameState';
import { getBearerToken, verifyToken } from '@/lib/auth';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  try {
    const token = getBearerToken(request);
    const claims = token ? verifyToken(token) : null;
    if (!claims || claims.role !== 'player' || claims.roomCode !== code.toUpperCase() || !claims.teamId) {
      return Response.json({ error: 'Unauthorized player token' }, { status: 401 });
    }

    const body = await request.json();
    const { listingId, offerPrice } = body;

    if (!listingId) {
      return Response.json({ error: 'listingId is required' }, { status: 400 });
    }

    const result = purchaseItem(code, claims.teamId, listingId, offerPrice);
    if ('error' in result && !('team' in result)) {
      return Response.json({ error: result.error }, { status: 400 });
    }

    return Response.json(result);
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }
}
