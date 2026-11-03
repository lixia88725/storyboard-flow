const firstRowTopTolerance = 4;

export const measureStoryboardGridColumnsFromTops = (shotTops: number[]): number => {
  const firstRowTop = [...shotTops]
    .map((top) => Math.round(top))
    .sort((a, b) => a - b)[0];

  if (firstRowTop === undefined) {
    return 1;
  }

  return Math.max(
    1,
    shotTops.filter((top) => Math.abs(Math.round(top) - firstRowTop) <= firstRowTopTolerance)
      .length
  );
};

export const measureStoryboardGridColumnsFromDom = (): number =>
  measureStoryboardGridColumnsFromTops(
    Array.from(document.querySelectorAll<HTMLElement>("[data-shot-id]")).map(
      (element) => element.getBoundingClientRect().top
    )
  );
