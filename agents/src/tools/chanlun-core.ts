import type {
  ChanlunAnalysis,
  ChanlunBar,
  ChanlunFractal,
  ChanlunHub,
  ChanlunStroke,
} from '../types/analysis.js';

function contains(left: ChanlunBar, right: ChanlunBar): boolean {
  return (
    (left.high >= right.high && left.low <= right.low) ||
    (right.high >= left.high && right.low <= left.low)
  );
}

function inferDirection(previous: ChanlunBar, current: ChanlunBar): 'up' | 'down' {
  if (current.high > previous.high || current.low > previous.low) {
    return 'up';
  }

  return 'down';
}

export function processContainment(bars: ChanlunBar[]): ChanlunBar[] {
  if (bars.length <= 1) {
    return [...bars];
  }

  const processed: ChanlunBar[] = [bars[0]!];

  for (let index = 1; index < bars.length; index++) {
    const current = bars[index]!;
    const previous = processed[processed.length - 1]!;

    if (!contains(previous, current)) {
      processed.push(current);
      continue;
    }

    const base = processed.length >= 2 ? processed[processed.length - 2]! : previous;
    const direction = inferDirection(base, previous);
    processed[processed.length - 1] = {
      ...previous,
      high: direction === 'up' ? Math.max(previous.high, current.high) : Math.min(previous.high, current.high),
      low: direction === 'up' ? Math.max(previous.low, current.low) : Math.min(previous.low, current.low),
      close: current.close,
    };
  }

  return processed;
}

export function detectFractals(bars: ChanlunBar[]): ChanlunFractal[] {
  const fractals: ChanlunFractal[] = [];

  for (let index = 1; index < bars.length - 1; index++) {
    const left = bars[index - 1]!;
    const middle = bars[index]!;
    const right = bars[index + 1]!;

    if (middle.high > left.high && middle.high > right.high) {
      fractals.push({
        type: 'top',
        index: middle.index,
        price: middle.high,
        confirmed: true,
      });
      continue;
    }

    if (middle.low < left.low && middle.low < right.low) {
      fractals.push({
        type: 'bottom',
        index: middle.index,
        price: middle.low,
        confirmed: true,
      });
    }
  }

  return fractals;
}

export function buildStrokes(fractals: ChanlunFractal[]): ChanlunStroke[] {
  const strokes: ChanlunStroke[] = [];

  for (let index = 1; index < fractals.length; index++) {
    const previous = fractals[index - 1]!;
    const current = fractals[index]!;

    if (previous.type === current.type) {
      continue;
    }

    if (current.index - previous.index < 2) {
      continue;
    }

    strokes.push({
      startIndex: previous.index,
      endIndex: current.index,
      startPrice: previous.price,
      endPrice: current.price,
      direction: current.price >= previous.price ? 'up' : 'down',
      high: Math.max(previous.price, current.price),
      low: Math.min(previous.price, current.price),
    });
  }

  return strokes;
}

export function buildHubs(strokes: readonly ChanlunStroke[]): ChanlunHub[] {
  const hubs: ChanlunHub[] = [];

  for (let index = 0; index <= strokes.length - 3; index++) {
    const window = strokes.slice(index, index + 3);
    const high = Math.min(...window.map((stroke) => stroke.high));
    const low = Math.max(...window.map((stroke) => stroke.low));

    if (low > high) {
      continue;
    }

    hubs.push({
      startIndex: window[0]!.startIndex,
      endIndex: window[2]!.endIndex,
      high,
      low,
      strokeIndices: [index, index + 1, index + 2],
    });
  }

  return hubs;
}

export function analyzeChanlun(bars: ChanlunBar[]): ChanlunAnalysis {
  const processedBars = processContainment(bars);
  const fractals = detectFractals(processedBars);
  const strokes = buildStrokes(fractals);
  const hubs = buildHubs(strokes);

  return {
    processedBars,
    fractals,
    strokes,
    hubs,
  };
}
