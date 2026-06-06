export type StoryboardLayoutRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const rowTolerancePx = 4;

const groupRectsByRow = (rects: StoryboardLayoutRect[]): StoryboardLayoutRect[][] => {
  const rows: StoryboardLayoutRect[][] = [];

  for (const rect of [...rects].sort((a, b) => a.top - b.top || a.left - b.left)) {
    const row = rows.find((candidateRow) => Math.abs(candidateRow[0].top - rect.top) <= rowTolerancePx);
    if (row) {
      row.push(rect);
    } else {
      rows.push([rect]);
    }
  }

  return rows;
};

export const storyboardRowGaps = (rects: StoryboardLayoutRect[]): number[] => {
  const rows = groupRectsByRow(rects);
  if (rows.length < 2) {
    return [];
  }

  return rows.slice(1).map((row, index) => {
    const previousRow = rows[index];
    const previousBottom = Math.max(...previousRow.map((rect) => rect.bottom));
    const currentTop = Math.min(...row.map((rect) => rect.top));
    return Math.round(currentTop - previousBottom);
  });
};

export const storyboardRowGapsAreConsistent = ({
  referenceRects,
  candidateRects,
  maxExtraGap
}: {
  referenceRects: StoryboardLayoutRect[];
  candidateRects: StoryboardLayoutRect[];
  maxExtraGap: number;
}): boolean => {
  const referenceMaxGap = Math.max(0, ...storyboardRowGaps(referenceRects));
  const candidateMaxGap = Math.max(0, ...storyboardRowGaps(candidateRects));
  return candidateMaxGap <= referenceMaxGap + maxExtraGap;
};
