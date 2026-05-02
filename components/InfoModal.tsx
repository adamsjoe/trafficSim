'use client';

interface InfoModalProps {
  onClose: () => void;
}

export default function InfoModal({ onClose }: InfoModalProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-icon">!</div>
        <h2 className="modal-title">No Roads Loaded</h2>
        <p className="modal-body">
          You need to load the road network before starting the simulation.
        </p>
        <ol className="modal-steps">
          <li>Type a location in the search bar (or use the default)</li>
          <li>Click <strong>Load Roads</strong> to fetch the road network</li>
          <li>Once roads appear on the map, click <strong>Start</strong></li>
        </ol>
        <p className="modal-tip">
          💡 Tip: click any road on the map to close it — cars will reroute around it.
        </p>
        <button className="btn btn-locate modal-btn" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}
