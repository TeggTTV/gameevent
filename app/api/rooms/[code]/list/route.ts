import { listItem } from '@/lib/gameState';
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
    const { itemId, askingPrice } = body;

    if (!itemId || askingPrice === undefined) {
      return Response.json({ error: 'itemId and askingPrice are required' }, { status: 400 });
    }

    const parsedAskingPrice = Number(askingPrice);
    if (!Number.isFinite(parsedAskingPrice) || parsedAskingPrice <= 0) {
      return Response.json({ error: 'askingPrice must be a valid number above $0' }, { status: 400 });
    }

    const result = listItem(code, claims.teamId, itemId, parsedAskingPrice);
    if ('error' in result) {
      return Response.json({ error: result.error }, { status: 400 });
    }

    return Response.json({
      listing: result.listing,
      team: {
        id: result.team.id,
        budget: result.team.budget,
        inventoryCount: result.team.inventory.length,
        activeListingsCount: result.team.activeListings.length,
      },
    });
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }
}
