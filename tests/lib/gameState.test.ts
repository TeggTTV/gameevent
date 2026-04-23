import { describe, expect, it } from 'vitest';

import {
  createRoom,
  getLeaderboard,
  getRoom,
  joinRoom,
  listItem,
  purchaseItem,
  unlistItem,
} from '@/lib/gameState';
import { RoomStatus, type Listing } from '@/lib/types';

describe('lib/gameState', () => {
  it('creates a room with expected defaults', () => {
    const room = createRoom(500, 1200, 6);

    expect(room.code).toHaveLength(5);
    expect(room.status).toBe(RoomStatus.LOBBY);
    expect(room.config).toEqual({
      startingBudget: 500,
      timerDuration: 1200,
      maxTeams: 6,
    });
    expect(room.teams).toEqual([]);
  });

  it('allows joining a room and adding multiple players to same team', () => {
    const room = createRoom(500, 1200, 6);

    const firstJoin = joinRoom(room.code, 'Blue Wolves', 'Alice');
    const secondJoin = joinRoom(room.code, 'Blue Wolves', 'Bob');

    if ('error' in firstJoin) throw new Error(firstJoin.error);
    if ('error' in secondJoin) throw new Error(secondJoin.error);

    expect(firstJoin.team.id).toBe(secondJoin.team.id);
    expect(secondJoin.team.players).toHaveLength(2);
  });

  it('rejects join when room is full', () => {
    const room = createRoom(500, 1200, 1);

    const firstJoin = joinRoom(room.code, 'Blue Wolves', 'Alice');
    if ('error' in firstJoin) throw new Error(firstJoin.error);

    const secondJoin = joinRoom(room.code, 'Red Hawks', 'Bob');

    expect(secondJoin).toEqual({ error: 'Room is full' });
  });

  it('handles purchase -> list -> unlist flow', () => {
    const room = createRoom(500, 1200, 6);
    const joined = joinRoom(room.code, 'Blue Wolves', 'Alice');
    if ('error' in joined) throw new Error(joined.error);

    const activeRoom = getRoom(room.code);
    if (!activeRoom) throw new Error('Room was not found');

    activeRoom.status = RoomStatus.ACTIVE;
    const storeListing: Listing = {
      id: 'listing_store_1',
      askingPrice: 40,
      listedAt: Date.now(),
      sellerId: '__store__',
      sellerName: 'Thrift Store',
      item: {
        id: 'item_1',
        name: 'Vintage Jacket',
        category: 'Outerwear',
        rarity: 'Rare' as const,
        condition: 'A' as const,
        basePrice: 30,
        marketPrice: 75,
      },
    };
    activeRoom.marketplace = [storeListing];

    const purchase = purchaseItem(room.code, joined.team.id, storeListing.id);
    if ('error' in purchase && !('team' in purchase)) throw new Error(purchase.error);

    const teamAfterPurchase = purchase.team;
    expect(teamAfterPurchase.budget).toBe(460);
    expect(teamAfterPurchase.inventory).toHaveLength(1);
    expect(activeRoom.marketplace).toHaveLength(0);

    const listResult = listItem(room.code, joined.team.id, teamAfterPurchase.inventory[0].id, 95);
    if ('error' in listResult) throw new Error(listResult.error);

    expect(listResult.team.inventory).toHaveLength(0);
    expect(listResult.team.activeListings).toHaveLength(1);
    expect(activeRoom.marketplace).toHaveLength(1);

    const listingId = listResult.listing.id;
    const unlistResult = unlistItem(room.code, joined.team.id, listingId);
    if ('error' in unlistResult) throw new Error(unlistResult.error);

    expect(unlistResult.team.inventory).toHaveLength(1);
    expect(unlistResult.team.activeListings).toHaveLength(0);
    expect(activeRoom.marketplace).toHaveLength(0);
  });

  it('sorts leaderboard by net profit descending', () => {
    const room = createRoom(500, 1200, 6);
    const j1 = joinRoom(room.code, 'Blue Wolves', 'Alice');
    const j2 = joinRoom(room.code, 'Red Hawks', 'Bob');
    if ('error' in j1 || 'error' in j2) throw new Error('Failed to join teams');

    const liveRoom = getRoom(room.code);
    if (!liveRoom) throw new Error('Room missing');

    liveRoom.teams[0].totalSpent = 200;
    liveRoom.teams[0].totalRevenue = 350;
    liveRoom.teams[1].totalSpent = 180;
    liveRoom.teams[1].totalRevenue = 240;

    const leaderboard = getLeaderboard(liveRoom);

    expect(leaderboard[0].teamName).toBe('Blue Wolves');
    expect(leaderboard[0].netProfit).toBe(150);
    expect(leaderboard[0].rank).toBe(1);
    expect(leaderboard[1].teamName).toBe('Red Hawks');
    expect(leaderboard[1].netProfit).toBe(60);
    expect(leaderboard[1].rank).toBe(2);
  });
});
