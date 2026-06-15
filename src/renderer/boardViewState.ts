import { useEffect, useRef, useState } from "react";

export type BoardViewSize = {
  width: number;
  height: number;
};

export type BoardViewState = {
  zoomLevel: number;
  isZoomScrubbing: boolean;
  isAnimationMode: boolean;
  animationImageSize: BoardViewSize;
  animationFrameSize: BoardViewSize;
};

export const initialBoardViewState = (): BoardViewState => ({
  zoomLevel: 100,
  isZoomScrubbing: false,
  isAnimationMode: false,
  animationImageSize: { width: 430, height: 271 },
  animationFrameSize: { width: 430, height: 271 }
});

export const useBoardViewState = () => {
  const initialState = initialBoardViewState();
  const [zoomLevel, setZoomLevel] = useState(initialState.zoomLevel);
  const [isZoomScrubbing, setIsZoomScrubbing] = useState(initialState.isZoomScrubbing);
  const [isAnimationMode, setIsAnimationMode] = useState(initialState.isAnimationMode);
  const [animationImageSize, setAnimationImageSize] = useState(initialState.animationImageSize);
  const [animationFrameSize, setAnimationFrameSize] = useState(initialState.animationFrameSize);
  const zoomLevelRef = useRef(zoomLevel);
  const isZoomScrubbingRef = useRef(isZoomScrubbing);
  const isAnimationModeRef = useRef(isAnimationMode);

  useEffect(() => {
    zoomLevelRef.current = zoomLevel;
  }, [zoomLevel]);

  useEffect(() => {
    isZoomScrubbingRef.current = isZoomScrubbing;
  }, [isZoomScrubbing]);

  useEffect(() => {
    isAnimationModeRef.current = isAnimationMode;
  }, [isAnimationMode]);

  return {
    zoomLevel,
    setZoomLevel,
    zoomLevelRef,
    isZoomScrubbing,
    setIsZoomScrubbing,
    isZoomScrubbingRef,
    isAnimationMode,
    setIsAnimationMode,
    isAnimationModeRef,
    animationImageSize,
    setAnimationImageSize,
    animationFrameSize,
    setAnimationFrameSize
  };
};
