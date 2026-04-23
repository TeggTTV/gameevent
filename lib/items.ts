import { Rarity, Condition, RARITY_MULTIPLIER, CONDITION_MODIFIER, Item } from './types';

// ===== Clothing Catalog =====

interface ClothingTemplate {
  name: string;
  category: string;
  basePrice: number;
}

const CLOTHING_CATALOG: ClothingTemplate[] = [
  // Tops
  { name: 'Graphic Tee', category: 'Tops', basePrice: 8 },
  { name: 'Band T-Shirt', category: 'Tops', basePrice: 12 },
  { name: 'Polo Shirt', category: 'Tops', basePrice: 14 },
  { name: 'Flannel Shirt', category: 'Tops', basePrice: 16 },
  { name: 'Denim Jacket', category: 'Tops', basePrice: 28 },
  { name: 'Leather Jacket', category: 'Tops', basePrice: 55 },
  { name: 'Varsity Jacket', category: 'Tops', basePrice: 35 },
  { name: 'Vintage Hoodie', category: 'Tops', basePrice: 22 },
  { name: 'Cropped Sweater', category: 'Tops', basePrice: 18 },
  { name: 'Hawaiian Shirt', category: 'Tops', basePrice: 15 },
  { name: 'Silk Blouse', category: 'Tops', basePrice: 32 },
  { name: 'Oversized Blazer', category: 'Tops', basePrice: 38 },
  { name: 'Cardigan', category: 'Tops', basePrice: 20 },
  { name: 'Windbreaker', category: 'Tops', basePrice: 25 },
  { name: 'Corduroy Jacket', category: 'Tops', basePrice: 30 },

  // Bottoms
  { name: 'Straight-Leg Jeans', category: 'Bottoms', basePrice: 18 },
  { name: 'Baggy Cargo Pants', category: 'Bottoms', basePrice: 22 },
  { name: 'Pleated Trousers', category: 'Bottoms', basePrice: 24 },
  { name: 'Corduroy Pants', category: 'Bottoms', basePrice: 20 },
  { name: 'Denim Shorts', category: 'Bottoms', basePrice: 12 },
  { name: 'Track Pants', category: 'Bottoms', basePrice: 15 },
  { name: 'Midi Skirt', category: 'Bottoms', basePrice: 16 },
  { name: 'Maxi Skirt', category: 'Bottoms', basePrice: 20 },

  // Dresses & Outerwear
  { name: 'Vintage Dress', category: 'Dresses', basePrice: 30 },
  { name: 'Slip Dress', category: 'Dresses', basePrice: 25 },
  { name: 'Trench Coat', category: 'Outerwear', basePrice: 45 },
  { name: 'Puffer Vest', category: 'Outerwear', basePrice: 28 },
  { name: 'Wool Overcoat', category: 'Outerwear', basePrice: 50 },

  // Accessories
  { name: 'Bucket Hat', category: 'Accessories', basePrice: 10 },
  { name: 'Leather Belt', category: 'Accessories', basePrice: 12 },
  { name: 'Silk Scarf', category: 'Accessories', basePrice: 15 },
  { name: 'Tote Bag', category: 'Accessories', basePrice: 18 },
  { name: 'Messenger Bag', category: 'Accessories', basePrice: 22 },
  { name: 'Vintage Sunglasses', category: 'Accessories', basePrice: 14 },
  { name: 'Beanie', category: 'Accessories', basePrice: 8 },
  { name: 'Canvas Sneakers', category: 'Footwear', basePrice: 25 },
  { name: 'Leather Boots', category: 'Footwear', basePrice: 40 },
  { name: 'Platform Shoes', category: 'Footwear', basePrice: 30 },
  { name: 'Loafers', category: 'Footwear', basePrice: 28 },
];

// Designer/brand prefixes for higher rarities
const BRAND_PREFIXES: Record<Rarity, string[]> = {
  [Rarity.COMMON]: ['', '', '', 'Old Navy', 'H&M', 'Gap'],
  [Rarity.UNCOMMON]: ['Vintage', 'Retro', 'Y2K', 'Nike', 'Adidas', 'Levi\'s'],
  [Rarity.RARE]: ['Ralph Lauren', 'Tommy Hilfiger', 'Stüssy', 'Carhartt', 'The North Face'],
  [Rarity.LEGENDARY]: ['Supreme', 'Comme des Garçons', 'Vivienne Westwood', 'Maison Margiela', 'Issey Miyake'],
};

// ===== Rarity & Condition Weights =====

const RARITY_WEIGHTS: { rarity: Rarity; weight: number }[] = [
  { rarity: Rarity.COMMON, weight: 50 },
  { rarity: Rarity.UNCOMMON, weight: 30 },
  { rarity: Rarity.RARE, weight: 15 },
  { rarity: Rarity.LEGENDARY, weight: 5 },
];

const CONDITION_WEIGHTS: { condition: Condition; weight: number }[] = [
  { condition: Condition.S, weight: 10 },
  { condition: Condition.A, weight: 35 },
  { condition: Condition.B, weight: 35 },
  { condition: Condition.C, weight: 20 },
];

// ===== Helper Functions =====

function weightedRandom<T>(items: { weight: number }[] & T[]): T {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  let random = Math.random() * totalWeight;
  for (const item of items) {
    random -= item.weight;
    if (random <= 0) return item;
  }
  return items[items.length - 1];
}

let itemCounter = 0;

export function generateItem(): Item {
  const template = CLOTHING_CATALOG[Math.floor(Math.random() * CLOTHING_CATALOG.length)];
  const rarityEntry = weightedRandom(RARITY_WEIGHTS);
  const conditionEntry = weightedRandom(CONDITION_WEIGHTS);

  const rarity = rarityEntry.rarity;
  const condition = conditionEntry.condition;

  // Pick a brand prefix for this rarity
  const prefixes = BRAND_PREFIXES[rarity];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const name = prefix ? `${prefix} ${template.name}` : template.name;

  const marketPrice = Math.round(
    template.basePrice * RARITY_MULTIPLIER[rarity] * CONDITION_MODIFIER[condition]
  );

  itemCounter++;

  return {
    id: `item_${Date.now()}_${itemCounter}`,
    name,
    category: template.category,
    rarity,
    condition,
    basePrice: template.basePrice,
    marketPrice,
  };
}

/**
 * Generates a store listing (auto-generated item on the marketplace).
 * Store price involves steep arbitrage discounts for rarer items.
 */
export function generateStoreListing(): import('./types').Listing {
  const item = generateItem();
  let askingPrice: number;

  if (item.rarity === Rarity.LEGENDARY) {
    // Legendary items: 5% to 15% of true value
    const variance = 0.05 + Math.random() * 0.10;
    askingPrice = Math.max(1, Math.round(item.marketPrice * variance));
  } else if (item.rarity === Rarity.RARE) {
    // Rare items: 20% to 30% of true value
    const variance = 0.20 + Math.random() * 0.10;
    askingPrice = Math.max(1, Math.round(item.marketPrice * variance));
  } else if (item.rarity === Rarity.UNCOMMON) {
    // Uncommon items: 50% to 70% of true value
    const variance = 0.50 + Math.random() * 0.20;
    askingPrice = Math.max(1, Math.round(item.marketPrice * variance));
  } else {
    // Common items: 90% to 115% of true value
    const variance = 0.9 + Math.random() * 0.25;
    askingPrice = Math.max(1, Math.round(item.marketPrice * variance));
  }

  return {
    id: `listing_${Date.now()}_${itemCounter}`,
    item,
    askingPrice,
    sellerId: '__store__',
    sellerName: 'Thrift Store',
    listedAt: Date.now(),
  };
}

/**
 * Generate multiple store listings at once.
 */
export function generateStoreListings(count: number): import('./types').Listing[] {
  const listings: import('./types').Listing[] = [];
  for (let i = 0; i < count; i++) {
    listings.push(generateStoreListing());
  }
  return listings;
}
