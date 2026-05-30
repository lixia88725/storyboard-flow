import { useRef } from "react";

type SketchSettingSliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
};

export const SketchSettingSlider = ({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange
}: SketchSettingSliderProps) => (
  <label className="sketch-setting">
    <span>{label}</span>
    <strong>
      {value}
      {suffix}
    </strong>
    <input
      aria-label={label}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  </label>
);

type BrushSwatchPickerProps = {
  swatches: string[];
  activeColor: string;
  onPickColor: (color: string) => void;
  onChangeSwatch: (index: number, color: string) => void;
};

export const BrushSwatchPicker = ({
  swatches,
  activeColor,
  onPickColor,
  onChangeSwatch
}: BrushSwatchPickerProps) => {
  const colorInputs = useRef<Array<HTMLInputElement | null>>([]);

  return (
    <div className="brush-swatch-picker" aria-label="Brush swatches">
      {swatches.map((color, index) => (
        <button
          key={index}
          type="button"
          className={color.toLowerCase() === activeColor.toLowerCase() ? "is-selected" : ""}
          style={{ backgroundColor: color }}
          aria-label={`Brush swatch ${index + 1}`}
          title="Click to pick, double-click to edit"
          onClick={() => onPickColor(color)}
          onDoubleClick={() => colorInputs.current[index]?.click()}
        >
          <input
            ref={(element) => {
              colorInputs.current[index] = element;
            }}
            aria-label={`Brush swatch ${index + 1} color`}
            type="color"
            value={color}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onChangeSwatch(index, event.target.value)}
          />
        </button>
      ))}
    </div>
  );
};
