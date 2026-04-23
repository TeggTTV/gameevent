import { joinRoom } from '@/lib/gameState';
import { issuePlayerToken } from '@/lib/auth';

const MAX_TEAM_NAME_LENGTH = 20;
const MAX_PLAYER_NAME_LENGTH = 20;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  try {
    const body = await request.json();
    const { teamName, playerName } = body;
    const normalizedTeamName = typeof teamName === 'string' ? teamName.trim() : '';
    const normalizedPlayerName = typeof playerName === 'string' ? playerName.trim() : '';

    if (!normalizedTeamName) {
      return Response.json({ error: 'Team name is required' }, { status: 400 });
    }
    if (!normalizedPlayerName) {
      return Response.json({ error: 'Player name is required' }, { status: 400 });
    }
    if (normalizedTeamName.length > MAX_TEAM_NAME_LENGTH) {
      return Response.json({ error: `Team name must be ${MAX_TEAM_NAME_LENGTH} characters or fewer` }, { status: 400 });
    }
    if (normalizedPlayerName.length > MAX_PLAYER_NAME_LENGTH) {
      return Response.json({ error: `Player name must be ${MAX_PLAYER_NAME_LENGTH} characters or fewer` }, { status: 400 });
    }

    const result = joinRoom(code, normalizedTeamName, normalizedPlayerName);
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
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }
}
