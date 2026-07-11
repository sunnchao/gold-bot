// SMC (Smart Money Concepts) type definitions
// Ported from internal/strategy/smc/types.go

export type SwingPoint = {
  index: number;  // Bar index in the source slice
  price: number;  // High for swing high, Low for swing low
  type: 'HIGH' | 'LOW';
};

export type StructureBreak = {
  index: number;     // Bar index where the break occurred
  direction: 'UP' | 'DOWN';  // Direction of the break
  level: number;     // The swing point price that was broken
  type: 'BOS' | 'CHoCH';  // BOS = continuation, CHoCH = reversal
};

export type FVG = {
  startIndex: number;   // First candle index
  endIndex: number;     // Third candle index
  side: 'BULL' | 'BEAR';
  upperBound: number;   // Top of the gap zone
  lowerBound: number;   // Bottom of the gap zone
  filled: boolean;      // Whether price has retraced into and filled the gap
  fillIndex: number;    // Bar index where gap was filled (0 = not filled)
};

export type OrderBlock = {
  index: number;     // Bar index of the order block candle
  side: 'BUY' | 'SELL';
  high: number;      // Upper bound of the OB zone
  low: number;       // Lower bound of the OB zone
  valid: boolean;    // Whether the OB is still unmitigated
  mitigated: boolean; // Whether price has returned and filled through the zone
  ageBars: number;   // Number of bars since formation
};

export type LiquiditySweep = {
  index: number;     // Bar index of the sweep candle
  level: number;     // The swing point level that was swept
  side: 'BULL' | 'BEAR';  // BULL = swept lows then reversed up, BEAR = swept highs then reversed down
  reversed: boolean; // Whether price has reversed after the sweep
};

export type SMCContext = {
  h4OBs: OrderBlock[];
  h1OBs: OrderBlock[];
  h1ShortOBs: OrderBlock[];  // lookback=20 for breakout_pyramid strategy
  m30OBs: OrderBlock[];
  m15OBs: OrderBlock[];
  h4FVGs: FVG[];
  h1FVGs: FVG[];
  m30FVGs: FVG[];
  m15FVGs: FVG[];
  h4Breaks: StructureBreak[];
  h1Breaks: StructureBreak[];
  m30Breaks: StructureBreak[];
  m15Breaks: StructureBreak[];
  h4Sweeps: LiquiditySweep[];
  h1Sweeps: LiquiditySweep[];
  m30Sweeps: LiquiditySweep[];
  m15Sweeps: LiquiditySweep[];

  // Trend direction derived from structure breaks
  h4TrendDirection: 'BULL' | 'BEAR' | 'NEUTRAL';
  h1TrendDirection: 'BULL' | 'BEAR' | 'NEUTRAL';
  m30TrendDirection: 'BULL' | 'BEAR' | 'NEUTRAL';
  m15TrendDirection: 'BULL' | 'BEAR' | 'NEUTRAL';
};
