// Harmonic pattern type definitions
// Ported from internal/strategy/harmonic/types.go

export type HarmonicPattern = {
  type: string;        // "gartley" | "bat" | "butterfly" | "crab" | "abcd"
  direction: string;   // "bullish" | "bearish"
  timeframe: string;   // "H4" | "H1" | "M30"
  status: string;      // "completed" | "invalidated" | "neutral"

  xIndex: number;
  aIndex: number;
  bIndex: number;
  cIndex: number;
  dIndex: number;

  xPrice: number;
  aPrice: number;
  bPrice: number;
  cPrice: number;
  dPrice: number;

  abRatio: number;
  bcRatio: number;
  cdRatio: number;
  xdRatio: number;

  przLow: number;
  przHigh: number;
  stopLoss: number;
  target1: number;
  target2: number;
  invalidated: boolean;

  score: number;
  confidence: number;
  reason: string;
};

export type HarmonicContext = {
  h4Patterns: HarmonicPattern[];
  h1Patterns: HarmonicPattern[];
  m30Patterns: HarmonicPattern[];

  activePattern: HarmonicPattern | null;
  directionBias: string;  // "bullish" | "bearish" | "neutral"
  score: number;
  summary: string;
};
