import { createRoom, joinRoom, startGame } from '@/lib/gameState';
import { issueFacilitatorToken, issuePlayerToken } from '@/lib/auth';

const FIXED_STARTING_BUDGET = 100;
const SOLO_TIMER_SECONDS = 20 * 60;
const SOLO_MAX_TEAMS = 1;
const MAX_TEAM_NAME_LENGTH = 20;

export async function POST(request: Request) {
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

    const room = createRoom(FIXED_STARTING_BUDGET, SOLO_TIMER_SECONDS, SOLO_MAX_TEAMS);
    const joinResult = joinRoom(room.code, normalizedTeamName, normalizedTeamName);

    if ('error' in joinResult) {
      return Response.json({ error: joinResult.error }, { status: 400 });
    }

    const startResult = startGame(room.code, room.facilitatorId);
    if ('error' in startResult) {
      return Response.json({ error: startResult.error }, { status: 400 });
    }

    const facilitatorToken = issueFacilitatorToken(room.code, room.facilitatorId);
    const playerToken = issuePlayerToken(room.code, joinResult.team.id, joinResult.player.id);

    return Response.json({
      roomCode: room.code,
      facilitatorId: room.facilitatorId,
      facilitatorToken,
      teamId: joinResult.team.id,
      teamName: joinResult.team.name,
      teamColor: joinResult.team.color,
      playerId: joinResult.player.id,
      playerName: joinResult.player.name,
      playerToken,
      budget: joinResult.team.budget,
      endsAt: startResult.room.endsAt,
      startingBudget: FIXED_STARTING_BUDGET,
    });
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.message.includes('BUSYTHRIFT_SINGLE_INSTANCE')) {
        return Response.json({
          error: 'Production setup required: set BUSYTHRIFT_SINGLE_INSTANCE=true for single-instance deployment or move game state to a shared datastore.',
        }, { status: 503 });
      }

      if (error.message.includes('LOCAL_AUTH_SECRET')) {
        return Response.json({
          error: 'Production setup required: set LOCAL_AUTH_SECRET to a strong random value.',
        }, { status: 503 });
      }
    }

    if (error instanceof SyntaxError) {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    return Response.json({ error: 'Failed to start solo game' }, { status: 500 });
  }
}
