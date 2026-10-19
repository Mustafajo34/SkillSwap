// The copyright line, shared by the landing page footer, the dashboard
// sidebar and Edit Profile. The year follows the calendar.
const COPYRIGHT_HOLDER = "H&J Technologies";

export default function Copyright({ className = "", style }) {
  return (
    <small className={className} style={style}>
      © {new Date().getFullYear()} {COPYRIGHT_HOLDER}. All rights reserved.
    </small>
  );
}
