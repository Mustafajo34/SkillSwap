import { useId, useState } from "react";

// Live Session → Settings panel. Everything here works on the live call:
//   Audio  · Original sound (no filters — for music) · Noise reduction
//          · Microphone · Speaker (browsers that can switch output)
//   Video  · Mirror my video (only your own preview) · Camera
// Choices are remembered on this device (hooks/useLocalMedia.js holds the
// mic/camera ones; the session room holds mirror + speaker).

const CAN_PICK_SPEAKER =
  typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

function DeviceSelect({ label, devices, value, onChange, empty, disabled }) {
  const id = useId();
  const known = devices.some((d) => d.id === value);
  return (
    <div className="device">
      <label htmlFor={id}>{label}</label>
      {devices.length ? (
        <select
          id={id}
          value={known ? value : ""}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          disabled={disabled}
        >
          {!known && <option value="">System default</option>}
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      ) : (
        <p className="device-empty">{empty}</p>
      )}
    </div>
  );
}

export default function SessionSettings({ media, mirror, setMirror, speakerId, setSpeakerId }) {
  const { prefs, devices } = media;
  const [busy, setBusy] = useState(false);
  // Switching reopens the mic, so one change at a time
  const run = async (task) => {
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  };
  const noDevicesYet = "Shows up once your camera and mic have started.";

  return (
    <div className="settings">
      <h3 className="settings-group">Audio</h3>
      <label>
        <span>
          <b>Original sound</b>
          <small>No echo or noise filtering — best for music and instruments</small>
        </span>
        <input
          type="checkbox"
          checked={prefs.originalSound}
          disabled={busy}
          onChange={(e) => run(() => media.setAudioOptions({ originalSound: e.target.checked }))}
        />
      </label>
      <label className={prefs.originalSound ? "is-disabled" : ""}>
        <span>
          <b>Noise reduction</b>
          <small>
            {prefs.originalSound
              ? "Off while Original sound is on"
              : "Filters out typing, fans and background chatter"}
          </small>
        </span>
        <input
          type="checkbox"
          checked={!prefs.originalSound && prefs.noiseReduction}
          disabled={busy || prefs.originalSound}
          onChange={(e) => run(() => media.setAudioOptions({ noiseReduction: e.target.checked }))}
        />
      </label>
      <DeviceSelect
        label="Microphone"
        devices={devices.mics}
        value={media.micId}
        disabled={busy}
        onChange={(id) => run(() => media.chooseMic(id))}
        empty={noDevicesYet}
      />
      {CAN_PICK_SPEAKER && (
        <DeviceSelect
          label="Speaker"
          devices={devices.speakers}
          value={speakerId}
          onChange={setSpeakerId}
          empty={noDevicesYet}
        />
      )}

      <h3 className="settings-group">Video</h3>
      <label>
        <span>
          <b>Mirror my video</b>
          <small>Only changes how you see yourself</small>
        </span>
        <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
      </label>
      <DeviceSelect
        label="Camera"
        devices={devices.cameras}
        value={media.cameraId}
        disabled={busy}
        onChange={(id) => run(() => media.chooseCamera(id))}
        empty={noDevicesYet}
      />
      {media.camera === false && devices.cameras.length > 0 && (
        <p className="settings-note">Your camera is off — the one you pick is used when you turn it on.</p>
      )}
      {media.deviceError && (
        <p className="settings-error" role="alert">
          {media.deviceError}
        </p>
      )}
    </div>
  );
}
