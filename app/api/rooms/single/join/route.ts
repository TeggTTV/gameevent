import { getOrCreateSingleInstanceRoom, joinRoom } from '@/lib/gameState';
import { issuePlayerToken } from '@/lib/auth';

const MAX_TEAM_NAME_LENGTH = 20;

export async function POST(request: Request) {
  if (process.env.BUSYTHRIFT_SINGLE_INSTANCE !== 'true') {
    return Response.json({ error: 'Single-instance mode is not enabled' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { teamName } = body;
    const normalizedTeamName = typeof teamName === 'string' ? teamName.trim() : '';

    if (!normalizedTeamName) {
      return Response.json({ error: 'Team name is required' }, { status: 400 });
    }

    if (normalizedTeamName.length > MAX_TEAM_NAME_LENGTH) {
      return Response.json({ error: `Team name must be ${MAX_TEAM_NAME_LENGTH} characters or fewer` }, { status: 400 });
    }

    const room = getOrCreateSingleInstanceRoom();
    const result = joinRoom(room.code, normalizedTeamName, normalizedTeamName);

    if ('error' in result) {
      return Response.json({ error: result.error }, { status: 400 });
    }

    return Response.json({
      teamId: result.team.id,
      teamName: result.team.name,
      teamColor: result.team.color,
      budget: result.team.budget,
      playerId: result.player.id,
      playerName: result.player.name,
      token: issuePlayerToken(result.room.code, result.team.id, result.player.id),
      roomCode: result.room.code,
      teams: result.room.teams.map(t => ({
        id: t.id,
        name: t.name,
        color: t.color,
      })),
    });
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (error instanceof Error && error.message.includes('BUSYTHRIFT_SINGLE_INSTANCE')) {
      return Response.json({
        error: 'Production setup required: set BUSYTHRIFT_SINGLE_INSTANCE=true for single-instance deployment.',
      }, { status: 503 });
    }

    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }
}
