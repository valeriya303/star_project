import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import Layout from "@/components/layout/Layout";
import Starfield from "@/components/brand/Starfield";
import RequireRole from "@/components/auth/RequireRole";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { CatalogProvider } from "@/context/CatalogContext";
import { DataProvider } from "@/context/DataContext";
import { LocationProvider } from "@/context/LocationContext";
import AuthPage from "@/pages/AuthPage";
import MapPage from "@/pages/MapPage";
import ListsPage from "@/pages/ListsPage";
import JournalPage from "@/pages/JournalPage";
import GalleryPage from "@/pages/GalleryPage";
import CommunityPage from "@/pages/CommunityPage";
import ProfilePage from "@/pages/ProfilePage";
import ModerationPage from "@/pages/ModerationPage";
import AdminPage from "@/pages/AdminPage";
import AboutDataPage from "@/pages/AboutDataPage";
import PrivacyPage from "@/pages/PrivacyPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import HelpPage from "@/pages/HelpPage";

function Home() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  return user ? <Navigate to="/map" replace /> : <AuthPage />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Starfield />
      <div className="app-shell">
      <AuthProvider>
        <LocationProvider>
          <CatalogProvider>
            <DataProvider>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route element={<Layout />}>
                  <Route path="/map" element={<MapPage />} />
                  <Route path="/community" element={<CommunityPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="/about-data" element={<AboutDataPage />} />
                  <Route path="/privacy" element={<PrivacyPage />} />
                  <Route path="/help" element={<HelpPage />} />
                  <Route path="/lists" element={<RequireRole roles={["OBSERVER", "MODERATOR"]}><ListsPage /></RequireRole>} />
                  <Route path="/journal" element={<RequireRole roles={["OBSERVER", "MODERATOR"]}><JournalPage /></RequireRole>} />
                  <Route path="/gallery" element={<RequireRole roles={["OBSERVER", "MODERATOR"]}><GalleryPage /></RequireRole>} />
                  <Route path="/moderation" element={<RequireRole roles={["MODERATOR"]}><ModerationPage /></RequireRole>} />
                  <Route path="/admin" element={<RequireRole roles={["DG_ADMIN"]}><AdminPage /></RequireRole>} />
                  <Route path="*" element={<Navigate to="/map" replace />} />
                </Route>
              </Routes>
            </DataProvider>
          </CatalogProvider>
        </LocationProvider>
      </AuthProvider>
      </div>
    </BrowserRouter>
  );
}
