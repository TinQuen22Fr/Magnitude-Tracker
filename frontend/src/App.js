import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Dashboard from "@/pages/Dashboard";
import Setup from "@/pages/Setup";
import Settings from "@/pages/Settings";
import Flasher from "@/pages/Flasher";
import AppShell from "@/components/AppShell";
import { Toaster } from "@/components/ui/sonner";
import { NightModeProvider } from "@/lib/nightMode";

function App() {
  return (
    <NightModeProvider>
      <div className="App dark" data-testid="app-shell">
        <BrowserRouter>
          <AppShell>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/setup" element={<Setup />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/flasher" element={<Flasher />} />
            </Routes>
          </AppShell>
        </BrowserRouter>
        <Toaster theme="dark" position="bottom-right" richColors closeButton />
      </div>
    </NightModeProvider>
  );
}

export default App;
