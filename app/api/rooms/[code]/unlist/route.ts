import { NextResponse } from 'next/server';
import { unlistItem, getTeamData } from '@/lib/gameState';
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
      return NextResponse.json({ error: 'Unauthorized player token' }, { status: 401 });
    }

    const body = await request.json();
    const { listingId } = body;

    if (!listingId) {
      return NextResponse.json({ error: 'listingId is required' }, { status: 400 });
    }

    const result = unlistItem(code, claims.teamId, listingId);

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // Return full team data
    const teamData = getTeamData(code, claims.teamId);

    return NextResponse.json({
      success: true,
      team: teamData,
    });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
