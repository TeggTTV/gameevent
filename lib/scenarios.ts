import { Scenario, Team, Listing } from './types';

const SCENARIO_TIMEOUT_MS = 45_000; // 45 seconds

let scenarioCounter = 0;

// ===== Scenario Factories =====

export function createScammedScenario(team: Team, purchasedItemId: string): Scenario | null {
  const item = team.inventory.find(i => i.id === purchasedItemId);
  if (!item) return null;

  // Only trigger on Rare or Legendary items (high-value)
  if (item.rarity !== 'Rare' && item.rarity !== 'Legendary') {
    // Small chance for Uncommon too
    if (item.rarity !== 'Uncommon' || Math.random() > 0.15) return null;
  }

  scenarioCounter++;
  return {
    id: `scenario_${Date.now()}_${scenarioCounter}`,
    type: 'scammed',
    title: '⚠️ Getting Scammed!',
    description: `You just noticed that your "${item.name}" might be a fake! The stitching looks off and the label seems suspicious. What do you do?`,
    options: [
      { label: 'Accept the loss', description: 'Write it off as a lesson learned. The item loses 60% of its value.' },
      { label: 'File a dispute', description: '50/50 chance: you recover the full value OR lose an additional $10 in fees.' },
      { label: 'Relist the fake', description: 'List it at a lower price. It becomes a Common item with C condition.' },
    ],
    targetItemId: purchasedItemId,
    expiresAt: Date.now() + SCENARIO_TIMEOUT_MS,
    resolved: false,
    votes: {},
  };
}

export function createViralMomentScenario(team: Team, listingId: string): Scenario | null {
  const listing = team.activeListings.find(l => l.id === listingId);
  if (!listing) return null;

  // Only trigger on Rare or Legendary
  if (listing.item.rarity !== 'Rare' && listing.item.rarity !== 'Legendary') return null;

  scenarioCounter++;
  return {
    id: `scenario_${Date.now()}_${scenarioCounter}`,
    type: 'viral',
    title: '🔥 Viral Moment!',
    description: `Your "${listing.item.name}" listing is getting attention! A fashion influencer just posted about a similar item. Demand is spiking!`,
    options: [
      { label: 'Raise the price', description: 'Increase price by 50%. Higher profit if it sells, but might scare off buyers.' },
      { label: 'Keep price steady', description: 'Guaranteed sale within 30 seconds at current price.' },
      { label: 'Wait and see', description: 'Auction-style: 50% chance price goes up 80%, 50% chance demand fizzles and you wait longer.' },
    ],
    targetListingId: listingId,
    expiresAt: Date.now() + SCENARIO_TIMEOUT_MS,
    resolved: false,
    votes: {},
  };
}

export function createShippingDelayScenario(team: Team, listingId: string): Scenario | null {
  const listing = team.activeListings.find(l => l.id === listingId);
  if (!listing) return null;

  scenarioCounter++;
  return {
    id: `scenario_${Date.now()}_${scenarioCounter}`,
    type: 'shipping_delay',
    title: '📦 Shipping Delay!',
    description: `The shipping for your "${listing.item.name}" is delayed! The buyer is getting impatient.`,
    options: [
      { label: 'Wait it out', description: 'Item is locked for 2 minutes, but you get paid full price when it sells.' },
      { label: 'Refund the buyer', description: 'Lose the sale, but keep the item in your inventory to relist.' },
      { label: 'Offer a discount', description: 'Item sells immediately at 25% off your asking price.' },
    ],
    targetListingId: listingId,
    expiresAt: Date.now() + SCENARIO_TIMEOUT_MS,
    resolved: false,
    votes: {},
  };
}

export function createUndercutScenario(team: Team, teamListingId: string, competitorListingId: string): Scenario | null {
  const listing = team.activeListings.find(l => l.id === teamListingId);
  if (!listing) return null;

  scenarioCounter++;
  return {
    id: `scenario_${Date.now()}_${scenarioCounter}`,
    type: 'undercut',
    title: '🔻 Undercut Alert!',
    description: `A competitor just listed a "${listing.item.category}" item cheaper than your "${listing.item.name}"! Your listing might get ignored.`,
    options: [
      { label: 'Drop your price', description: 'Match the competitor\'s price minus $1. Competitive but lower profit.' },
      { label: 'Hold firm', description: 'Keep your price and bet on your item\'s better quality. Risky.' },
      { label: 'Pull the listing', description: 'Remove your listing and wait for the competitor\'s item to sell first.' },
    ],
    targetListingId: teamListingId,
    competitorListingId: competitorListingId,
    expiresAt: Date.now() + SCENARIO_TIMEOUT_MS,
    resolved: false,
    votes: {},
  };
}

// ===== Scenario Resolution =====

export interface ScenarioOutcome {
  outcomeText: string;
  budgetChange?: number;
  modifyItem?: {
    itemId: string;
    newMarketPrice?: number;
  };
  modifyListing?: {
    listingId: string;
    newAskingPrice?: number;
    lock?: boolean;
    lockDurationMs?: number;
    instantSell?: boolean;
    instantSellPrice?: number;
    pullListing?: boolean;
  };
  guaranteedSale?: {
    listingId: string;
    delayMs: number;
  };
}

export function resolveScenario(
  scenario: Scenario,
  optionIndex: number,
  team: Team,
  _competitorListing?: Listing
): ScenarioOutcome {
  switch (scenario.type) {
    case 'scammed':
      return resolveScammed(scenario, optionIndex, team);
    case 'viral':
      return resolveViral(scenario, optionIndex, team);
    case 'shipping_delay':
      return resolveShippingDelay(scenario, optionIndex, team);
    case 'undercut':
      return resolveUndercut(scenario, optionIndex, team, _competitorListing);
    default:
      return { outcomeText: 'Scenario resolved with no effect.' };
  }
}

function resolveScammed(scenario: Scenario, optionIndex: number, team: Team): ScenarioOutcome {
  const item = team.inventory.find(i => i.id === scenario.targetItemId);
  if (!item) return { outcomeText: 'The item is no longer in your inventory.' };

  switch (optionIndex) {
    case 0: // Accept the loss
      return {
        outcomeText: `You accepted the loss. "${item.name}" value dropped by 60%.`,
        modifyItem: {
          itemId: item.id,
          newMarketPrice: Math.round(item.marketPrice * 0.4),
        },
      };
    case 1: { // File dispute (50/50)
      const success = Math.random() > 0.5;
      if (success) {
        return {
          outcomeText: `Dispute successful! You recovered the full value of "${item.name}". Lucky!`,
        };
      } else {
        return {
          outcomeText: `Dispute failed! You lost the case and paid $10 in fees.`,
          budgetChange: -10,
        };
      }
    }
    case 2: // Relist the fake
      return {
        outcomeText: `You're relisting "${item.name}" as a Common/Fair item at a lower price.`,
        modifyItem: {
          itemId: item.id,
          newMarketPrice: Math.round(item.basePrice * 0.75), // Common × C condition
        },
      };
    default:
      return { outcomeText: 'No action taken.' };
  }
}

function resolveViral(scenario: Scenario, optionIndex: number, team: Team): ScenarioOutcome {
  const listing = team.activeListings.find(l => l.id === scenario.targetListingId);
  if (!listing) return { outcomeText: 'The listing is no longer active.' };

  switch (optionIndex) {
    case 0: // Raise price 50%
      return {
        outcomeText: `You raised the price of "${listing.item.name}" by 50%! Fingers crossed it sells.`,
        modifyListing: {
          listingId: listing.id,
          newAskingPrice: Math.round(listing.askingPrice * 1.5),
        },
      };
    case 1: // Keep price — guaranteed quick sale
      return {
        outcomeText: `Smart move! "${listing.item.name}" will sell at the current price very soon.`,
        guaranteedSale: {
          listingId: listing.id,
          delayMs: 15_000 + Math.random() * 15_000, // 15-30 seconds
        },
      };
    case 2: { // Wait and see (50/50)
      const lucky = Math.random() > 0.5;
      if (lucky) {
        return {
          outcomeText: `Demand surged! "${listing.item.name}" price increased by 80%!`,
          modifyListing: {
            listingId: listing.id,
            newAskingPrice: Math.round(listing.askingPrice * 1.8),
          },
        };
      } else {
        return {
          outcomeText: `The hype fizzled out. "${listing.item.name}" stays at current price. Better luck next time.`,
        };
      }
    }
    default:
      return { outcomeText: 'No action taken.' };
  }
}

function resolveShippingDelay(scenario: Scenario, optionIndex: number, team: Team): ScenarioOutcome {
  const listing = team.activeListings.find(l => l.id === scenario.targetListingId);
  if (!listing) return { outcomeText: 'The listing is no longer active.' };

  switch (optionIndex) {
    case 0: // Wait it out — lock for 2 min
      return {
        outcomeText: `You're waiting it out. "${listing.item.name}" is locked for 2 minutes but will sell at full price.`,
        modifyListing: {
          listingId: listing.id,
          lock: true,
          lockDurationMs: 120_000,
        },
      };
    case 1: // Refund buyer — keep item
      return {
        outcomeText: `You refunded the buyer. "${listing.item.name}" is back in your inventory.`,
        modifyListing: {
          listingId: listing.id,
          pullListing: true,
        },
      };
    case 2: // Offer discount — instant sale at 75%
      return {
        outcomeText: `You offered a 25% discount. "${listing.item.name}" sold immediately at $${Math.round(listing.askingPrice * 0.75)}!`,
        modifyListing: {
          listingId: listing.id,
          instantSell: true,
          instantSellPrice: Math.round(listing.askingPrice * 0.75),
        },
      };
    default:
      return { outcomeText: 'No action taken.' };
  }
}

function resolveUndercut(scenario: Scenario, optionIndex: number, team: Team, competitorListing?: Listing): ScenarioOutcome {
  const listing = team.activeListings.find(l => l.id === scenario.targetListingId);
  if (!listing) return { outcomeText: 'The listing is no longer active.' };

  const competitorPrice = competitorListing?.askingPrice ?? Math.round(listing.askingPrice * 0.85);

  switch (optionIndex) {
    case 0: // Drop price to match - $1
      return {
        outcomeText: `You dropped the price of "${listing.item.name}" to $${Math.max(1, competitorPrice - 1)} to undercut the competition!`,
        modifyListing: {
          listingId: listing.id,
          newAskingPrice: Math.max(1, competitorPrice - 1),
        },
      };
    case 1: // Hold firm
      return {
        outcomeText: `You're holding firm on "${listing.item.name}" at $${listing.askingPrice}. Quality speaks for itself... hopefully.`,
      };
    case 2: // Pull listing
      return {
        outcomeText: `You pulled "${listing.item.name}" from the marketplace. You can relist it later.`,
        modifyListing: {
          listingId: listing.id,
          pullListing: true,
        },
      };
    default:
      return { outcomeText: 'No action taken.' };
  }
}

/**
 * Get the default outcome when a scenario times out.
 */
export function getDefaultOutcome(): number {
  // Default to option 0 (first/safest option) on timeout
  return 0;
}
