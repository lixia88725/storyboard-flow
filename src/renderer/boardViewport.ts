export const currentBoardScroll = (
  scrollContainer: Pick<HTMLElement, "scrollLeft" | "scrollTop"> | null
) =>
  scrollContainer
    ? { x: scrollContainer.scrollLeft, y: scrollContainer.scrollTop }
    : { x: window.scrollX, y: window.scrollY };

export const boardViewportHeight = (scrollContainer: Pick<HTMLElement, "clientHeight"> | null) =>
  scrollContainer?.clientHeight ?? window.innerHeight;

export const scrollBoardBy = (
  scrollContainer: Pick<HTMLElement, "scrollBy"> | null,
  options: ScrollToOptions
) => {
  if (scrollContainer) {
    scrollContainer.scrollBy(options);
    return;
  }

  window.scrollBy(options);
};
