import { Route, Routes } from "react-router-dom";
import Landing from "./pages/Landing";
import AuthProvider from "./auth/AuthProvider";
import ProtectedRoutes from "./router/ProtectedRoutes";
import Dashboard from "./pages/Dashboard";
// Loaded with the app (not lazily) so opening it from the menu is instant
import EditProfile from "./pages/EditProfile";

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        {/* Protected routes */}
        <Route element={<ProtectedRoutes />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/profile" element={<EditProfile />} />
        </Route>
        <Route />
      </Routes>
    </AuthProvider>
  );
}

export default App;
