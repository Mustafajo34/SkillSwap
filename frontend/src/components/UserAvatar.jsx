import { useState } from "react";
import { colorOf, initialsOf } from "../utils/people";
import { photoUrl, usePhotoVersion } from "../utils/photos";

// Any person's avatar, anywhere in the app: their profile photo if they have
// one (kept in sync live — see utils/photos.js), otherwise their initials on
// a colour picked from their id. The wrapper takes whatever size/shape
// classes the spot needs; `children` (e.g. an online dot) go on top.
//
//   <UserAvatar id={m.id} name={m.name} photoV={m.photoV} className="…" />
//
// photo={false} always shows initials (for compact lists that shouldn't
// show pictures).

export default function UserAvatar({
  id,
  name,
  photoV,
  className = "",
  style,
  alt = "",
  photo = true,
  children,
}) {
  const version = usePhotoVersion(id, photoV);
  const src = photo && id && version ? photoUrl(id, version) : null;
  // Remember a URL that failed to load (deleted photo, offline…) → initials
  const [failed, setFailed] = useState(null);
  const showPhoto = src && failed !== src;
  const color = colorOf(id);

  return (
    <span
      className={className}
      style={{ background: color, "--avatar": color, ...style }}
      aria-hidden={alt ? undefined : true}
    >
      {showPhoto ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(src)}
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            borderRadius: "inherit",
          }}
        />
      ) : (
        initialsOf(name)
      )}
      {children}
    </span>
  );
}
