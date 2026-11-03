import { forwardRef, useImperativeHandle, useRef } from "react";
import { createPortal } from "react-dom";
import type {
  MarqueeOverlayRect,
  MarqueeViewportRect
} from "./storyboardMarquee";

export type MarqueeOverlayHandle = {
  show: (viewportRect: MarqueeViewportRect) => void;
  renderBox: (rect: MarqueeOverlayRect) => void;
  renderSelection: (rects: readonly MarqueeOverlayRect[]) => void;
  hide: () => void;
};

export const SelectionMarquee = forwardRef<MarqueeOverlayHandle>(function SelectionMarquee(_, ref) {
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const boxRectRef = useRef<MarqueeOverlayRect | undefined>(undefined);
  const selectionRectsRef = useRef<readonly MarqueeOverlayRect[]>([]);
  const devicePixelRatioRef = useRef(1);
  const viewportSizeRef = useRef({ width: 0, height: 0 });

  const draw = () => {
    const overlay = overlayRef.current;
    const context = overlay?.getContext("2d");
    if (!overlay || !context) {
      return;
    }
    const devicePixelRatio = devicePixelRatioRef.current;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, overlay.width, overlay.height);
    context.setTransform(
      devicePixelRatio,
      0,
      0,
      devicePixelRatio,
      0,
      0
    );

    const boxRect = boxRectRef.current;
    if (boxRect) {
      context.fillStyle = "rgba(80, 191, 165, 0.14)";
      context.strokeStyle = "#50bfa5";
      context.lineWidth = 1;
      context.fillRect(
        boxRect.left,
        boxRect.top,
        boxRect.width,
        boxRect.height
      );
      context.strokeRect(
        boxRect.left + 0.5,
        boxRect.top + 0.5,
        Math.max(0, boxRect.width - 1),
        Math.max(0, boxRect.height - 1)
      );
    }

    context.strokeStyle = "rgba(255, 100, 45, 0.78)";
    context.lineWidth = 2;
    for (const rect of selectionRectsRef.current) {
      context.strokeRect(
        rect.left + 1,
        rect.top + 1,
        Math.max(0, rect.width - 2),
        Math.max(0, rect.height - 2)
      );
    }

    if (boxRect) {
      const label = `${selectionRectsRef.current.length} selected`;
      context.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
      const labelWidth = Math.ceil(context.measureText(label).width) + 14;
      const labelHeight = 24;
      const viewportSize = viewportSizeRef.current;
      const labelX = Math.max(
        4,
        Math.min(
          viewportSize.width - labelWidth - 4,
          boxRect.left + boxRect.width - labelWidth
        )
      );
      const preferredLabelY = boxRect.top + boxRect.height + 6;
      const labelY =
        preferredLabelY + labelHeight <= viewportSize.height - 4
          ? preferredLabelY
          : Math.max(4, boxRect.top - labelHeight - 6);
      context.fillStyle = "rgba(21, 23, 25, 0.88)";
      context.fillRect(labelX, labelY, labelWidth, labelHeight);
      context.fillStyle = "rgba(255, 250, 240, 0.96)";
      context.textBaseline = "middle";
      context.fillText(label, labelX + 7, labelY + labelHeight / 2);
    }
  };

  useImperativeHandle(ref, () => ({
    show(viewportRect) {
      const overlay = overlayRef.current;
      if (!overlay) {
        return;
      }
      overlay.style.transform = `translate3d(${viewportRect.left}px, ${viewportRect.top}px, 0)`;
      overlay.style.width = `${viewportRect.width}px`;
      overlay.style.height = `${viewportRect.height}px`;
      const devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);
      devicePixelRatioRef.current = devicePixelRatio;
      viewportSizeRef.current = {
        width: viewportRect.width,
        height: viewportRect.height
      };
      overlay.width = Math.ceil(viewportRect.width * devicePixelRatio);
      overlay.height = Math.ceil(viewportRect.height * devicePixelRatio);
      overlay.classList.add("is-active");
      draw();
    },
    renderBox(rect) {
      boxRectRef.current = rect;
      draw();
    },
    renderSelection(rects) {
      selectionRectsRef.current = rects;
      if (overlayRef.current) {
        overlayRef.current.dataset.selectedCount = String(rects.length);
      }
      draw();
    },
    hide() {
      const overlay = overlayRef.current;
      if (!overlay) {
        return;
      }
      overlay.classList.remove("is-active");
      boxRectRef.current = undefined;
      selectionRectsRef.current = [];
      viewportSizeRef.current = { width: 0, height: 0 };
      overlay.style.removeProperty("transform");
      overlay.style.removeProperty("width");
      overlay.style.removeProperty("height");
      delete overlay.dataset.selectedCount;
      overlay.getContext("2d")?.clearRect(0, 0, overlay.width, overlay.height);
    }
  }), []);

  return createPortal(
    <canvas
      ref={overlayRef}
      className="selection-marquee"
      aria-hidden="true"
    />,
    document.body
  );
});
