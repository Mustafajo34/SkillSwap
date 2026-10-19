import { Outlet, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
const ProtectedRoutes = () => {
  const { authorized, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div>...Loading</div>;

  // Remember where they were headed (e.g. a Live Session link) so signing
  // in can bring them back there.
  return authorized ? (
    <Outlet />
  ) : (
    <Navigate to="/" replace state={{ from: location }} />
  );
};

export default ProtectedRoutes;
