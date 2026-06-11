import { Brush, Eraser, Images, Keyboard, LassoSelect, SquareX } from "lucide-react";

const lucideIconProps = {
  className: "tool-icon",
  "aria-hidden": true,
  focusable: false
} as const;

export const CardFaceIcon = () => <Images {...lucideIconProps} />;

export const GearIcon = () => <Keyboard {...lucideIconProps} />;

export const BrushIcon = () => <Brush {...lucideIconProps} />;

export const EraserIcon = () => <Eraser {...lucideIconProps} />;

export const SelectIcon = () => <LassoSelect {...lucideIconProps} />;

export const ClearIcon = () => <SquareX {...lucideIconProps} />;

export const SwatchIcon = () => (
  <svg className="tool-icon swatch-icon" viewBox="0 0 24 24" aria-hidden="true">
    <rect className="swatch-icon-fill" x="6" y="6" width="12" height="12" rx="1.8" />
    <rect x="6" y="6" width="12" height="12" rx="1.8" />
  </svg>
);

export const SidePanelIcon = () => (
  <svg className="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="4" y="5" width="16" height="14" rx="1.8" />
    <path d="M15 5v14" />
  </svg>
);
