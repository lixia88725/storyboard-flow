import type { Dialogue, Shot } from "../shared/types";

export const DialoguePreview = ({ dialogue }: { dialogue: Dialogue }) => {
  return <div className="dialogue-preview">{dialogue.text || "Empty dialogue"}</div>;
};

export const ShotStackPreview = ({ shots }: { shots: Shot[] }) => {
  const visibleShots = shots.slice(0, 4);

  return (
    <div className="shot-stack-preview">
      {visibleShots.map((shot, index) => (
        <div
          key={shot.id}
          className="shot-stack-card"
          style={{
            transform: `translate(${index * 10}px, ${index * 8}px) rotate(${index * 1.5 - 2}deg)`,
            zIndex: visibleShots.length - index
          }}
        >
          <img
            src={window.storyboard.assetUrl(shot.previewPath ?? shot.imagePath)}
            alt=""
            draggable={false}
          />
          <span>{shot.fileName}</span>
        </div>
      ))}
      {shots.length > 1 ? <strong>{shots.length}</strong> : null}
    </div>
  );
};
