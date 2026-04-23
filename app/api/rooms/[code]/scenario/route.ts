import { respondToScenario, skipScenario } from '@/lib/gameState';
import { getBearerToken, verifyToken } from '@/lib/auth';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  try {
    const token = getBearerToken(request);
    const claims = token ? verifyToken(token) : null;
    if (!claims || claims.role !== 'player' || claims.roomCode !== code.toUpperCase() || !claims.teamId || !claims.playerId) {
      return Response.json({ error: 'Unauthorized player token' }, { status: 401 });
    }

    const body = await request.json();
    const { scenarioId, optionIndex, skip } = body;

    if (!scenarioId) {
      return Response.json({ error: 'scenarioId is required' }, { status: 400 });
    }

    if (!skip && optionIndex === undefined) {
      return Response.json({ error: 'optionIndex is required unless skipping scenario' }, { status: 400 });
    }

    if (!skip) {
      const parsedOption = Number(optionIndex);
      if (!Number.isInteger(parsedOption) || parsedOption < 0 || parsedOption > 2) {
        return Response.json({ error: 'optionIndex must be an integer between 0 and 2' }, { status: 400 });
      }
    }

    const result = skip
      ? skipScenario(code, claims.teamId, claims.playerId, scenarioId)
      : respondToScenario(code, claims.teamId, claims.playerId, scenarioId, Number(optionIndex));

    if ('error' in result) {
      return Response.json({ error: result.error }, { status: 400 });
    }

    return Response.json({
      status: result.status,
      outcomeText: result.outcome?.outcomeText,
      team: {
        id: result.team.id,
        budget: result.team.budget,
      },
    });
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }
}
