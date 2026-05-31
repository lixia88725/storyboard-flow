import type { MarqueeBox } from "./storyboardMarquee";

export const SelectionMarquee = ({ box }: { box: MarqueeBox }) => {
  const left = Math.min(box.startX, box.currentX);
  const top = Math.min(box.startY, box.currentY);
  const width = Math.abs(box.currentX - box.startX);
  const height = Math.abs(box.currentY - box.startY);

  return <div className="selection-marquee" style={{ left, top, width, height }} />;
};
