import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Dashboard from "@/pages/Dashboard";
import Setup from "@/pages/Setup";
import Settings from "@/pages/Settings";
import Flasher from "@/pages/Flasher";
import Login from "@/pages/Login";
import Account from "@/pages/Account";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import { Toaster } from "@/components/ui/sonner";
import { NightModeProvider } from "@/lib/nightMode";
import { AuthProvider } from "@/lib/authContext";

function App() {
  return (
    <NightModeProvider>
      <AuthProvider>
        <div className="App dark" data-testid="app-shell">
          <BrowserRouter>
            <AppShell>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/setup" element={<Setup />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/flasher" element={<Flasher />} />
                <Route path="/login" element={<Login />} />
                <Route
                  path="/account"
                  element={
                    <RequireAuth>
                      <Account />
                    </RequireAuth>
                  }
                />
              </Routes>
            </AppShell>
          </BrowserRouter>
          <Toaster theme="dark" position="bottom-right" richColors closeButton />
        </div>
      </AuthProvider>
    </NightModeProvider>
  );
}

export default App;
