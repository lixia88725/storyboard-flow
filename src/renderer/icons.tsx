import {
  Brush,
  Copy,
  Eraser,
  Keyboard,
  LassoSelect,
  Pipette,
  Settings,
  SquareX,
  X
} from "lucide-react";

const lucideIconProps = {
  className: "tool-icon",
  "aria-hidden": true,
  focusable: false
} as const;

export const GearIcon = () => <Keyboard {...lucideIconProps} />;

export const SettingsIcon = () => <Settings {...lucideIconProps} />;

export const CopyIcon = () => <Copy {...lucideIconProps} />;

export const BrushIcon = () => <Brush {...lucideIconProps} />;

export const EraserIcon = () => <Eraser {...lucideIconProps} />;

export const EyedropperIcon = () => <Pipette {...lucideIconProps} />;

export const SelectIcon = () => <LassoSelect {...lucideIconProps} />;

export const BlurIcon = () => (
  <svg className="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="8" cy="12" r="4.25" />
    <circle cx="15.5" cy="8.5" r="1.25" />
    <circle cx="17" cy="13" r="1.75" />
    <circle cx="14.5" cy="17.25" r="1" />
  </svg>
);

export const ClearIcon = () => <SquareX {...lucideIconProps} />;

export const CloseIcon = () => <X {...lucideIconProps} />;

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

export const StoryboardGridIcon = () => (
  <svg className="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="4" y="5" width="6" height="5" rx="1.1" />
    <rect x="14" y="5" width="6" height="5" rx="1.1" />
    <rect x="4" y="14" width="6" height="5" rx="1.1" />
    <rect x="14" y="14" width="6" height="5" rx="1.1" />
  </svg>
);

export const JapaneseStoryboardIcon = () => (
  <svg className="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 6h14" />
    <path d="M5 12h14" />
    <path d="M5 18h14" />
  </svg>
);

export const MatteIcon = () => (
  <svg className="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="4" y="5" width="16" height="14" rx="1.8" />
    <path className="tool-icon-fill" d="M4 5h16v4H4zM4 15h16v4H4z" />
  </svg>
);

export const DialogueOverlayIcon = () => (
  <svg className="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="4" y="5" width="16" height="14" rx="1.8" />
    <path d="M7 15h7" />
    <path d="M7 17.5h10" />
  </svg>
);
