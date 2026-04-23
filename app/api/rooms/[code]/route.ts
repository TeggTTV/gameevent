import { getRoom } from '@/lib/gameState';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const room = getRoom(code);
  if (!room) {
    return Response.json({ error: 'Room not found' }, { status: 404 });
  }

  return Response.json({
    code: room.code,
    status: room.status,
    config: room.config,
    teams: room.teams.map(t => ({
      id: t.id,
      name: t.name,
      color: t.color,
    })),
    startedAt: room.startedAt,
    endsAt: room.endsAt,
  });
}
