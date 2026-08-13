export type VideoFrame = { width: number; height: number };
export type DisplayBounds = { left: number; top: number; width: number; height: number };

export function normalizedVideoPoint(
  clientX: number,
  clientY: number,
  bounds: DisplayBounds,
  video: VideoFrame,
) {
  const frameAspect = bounds.width / bounds.height;
  const videoAspect = video.width > 0 && video.height > 0
    ? video.width / video.height
    : frameAspect;
  const renderedWidth = videoAspect > frameAspect ? bounds.width : bounds.height * videoAspect;
  const renderedHeight = videoAspect > frameAspect ? bounds.width / videoAspect : bounds.height;
  const offsetX = bounds.left + (bounds.width - renderedWidth) / 2;
  const offsetY = bounds.top + (bounds.height - renderedHeight) / 2;
  return {
    x: Math.min(1, Math.max(0, (clientX - offsetX) / renderedWidth)),
    y: Math.min(1, Math.max(0, (clientY - offsetY) / renderedHeight)),
    inside: clientX >= offsetX && clientX <= offsetX + renderedWidth
      && clientY >= offsetY && clientY <= offsetY + renderedHeight,
  };
}
