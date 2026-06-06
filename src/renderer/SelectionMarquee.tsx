import { forwardRef } from "react";

export const SelectionMarquee = forwardRef<HTMLDivElement>(function SelectionMarquee(_, ref) {
  return <div ref={ref} className="selection-marquee" />;
});
