import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './index.css';
import { api } from './api';
import { currentUser, currentView } from './state';
import { Header } from './components/Header';
import { MobileNav } from './components/MobileNav';
import { Toast } from './components/Toast';
import { AccountSheet } from './components/AccountSheet';
import { ProfileModal } from './views/ProfileModal';
import { LoginView } from './views/LoginView';
import { MonthView } from './views/MonthView';
import { TimelineView } from './views/TimelineView';
import { ListView } from './views/ListView';
import { StatsView } from './views/StatsView';
import { AdminConsole } from './views/AdminConsole';
import { PublicScheduleView } from './views/PublicScheduleView';
import { ReservationModal } from './views/ReservationModal';
import { PasswordChangeModal } from './views/PasswordChangeModal';

function App() {
  const [initLoading, setInitLoading] = useState(true);

  useEffect(() => {
    // Check active session on load
    api
      .getMe()
      .then((res) => {
        if (res.success && res.user) {
          currentUser.value = res.user;
        }
      })
      .catch(() => {
        currentUser.value = null;
      })
      .finally(() => {
        setInitLoading(false);
      });
  }, []);

  if (initLoading) {
    return (
      <div class="min-h-screen flex items-center justify-center">
        <div class="glass flex flex-col items-center gap-3 px-8 py-6 rounded-[28px]">
          <div class="w-9 h-9 rounded-full border-[3px] border-accent border-t-transparent animate-spin"></div>
          <span class="text-[13px] font-semibold text-label-2">系統載入中…</span>
        </div>
      </div>
    );
  }

  const user = currentUser.value;
  const view = currentView.value;
  // Mirrors MobileNav's own early return: the login screen has no tab bar.
  const showTabBar = !!user || view === 'public';

  return (
    <div class="min-h-screen flex flex-col text-black">
      <Header />
      <MobileNav />

      {/* Bottom padding below md keeps the last row clear of the floating tab bar. */}
      <main class={`flex-1 ${showTabBar ? 'pb-28 md:pb-0' : ''}`}>
        {!user && view !== 'public' ? (
          <LoginView />
        ) : (
          <>
            {view === 'month' && <MonthView />}
            {view === 'timeline' && <TimelineView />}
            {view === 'list' && <ListView />}
            {view === 'stats' && <StatsView />}
            {view === 'admin' && <AdminConsole />}
            {view === 'public' && <PublicScheduleView />}
          </>
        )}
      </main>

      <Toast />
      <ReservationModal />
      <PasswordChangeModal />
      <ProfileModal />
      <AccountSheet />

      <footer class="hidden md:block py-5 text-center text-xs text-label-2">
        <div class="max-w-[1400px] mx-auto px-8">
          新竹市衛生局 版權所有 © 2026 · Meeting Room Booking System v2.0 公務版
        </div>
      </footer>
    </div>
  );
}

render(<App />, document.getElementById('app')!);
