import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './index.css';
import { api } from './api';
import { currentUser, currentView } from './state';
import { Header } from './components/Header';
import { MobileNav } from './components/MobileNav';
import { Toast } from './components/Toast';
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
      <div class="min-h-screen flex items-center justify-center bg-[#dedbd5]">
        <div class="flex flex-col items-center gap-3">
          <div class="w-10 h-10 border-4 border-[#9e3526] border-t-transparent animate-spin"></div>
          <span class="text-xs font-bold text-[#605d5d]">系統載入中...</span>
        </div>
      </div>
    );
  }

  const user = currentUser.value;
  const view = currentView.value;

  return (
    <div class="min-h-screen flex flex-col bg-[#dedbd5] text-[#201e1d]">
      <Header />
      <MobileNav />

      <main class="flex-1">
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

      <footer class="bg-[#f3f2f2] border-t-2 border-[#201e1d] py-3.5 sm:py-4 text-center text-[11px] sm:text-xs text-[#605d5d] mt-auto">
        <div class="max-w-7xl mx-auto px-4 font-semibold leading-relaxed">
          新竹市衛生局 版權所有 © 2026
          <span class="hidden sm:inline"> Meeting Room Booking System v2.0 公務版</span>
          <span class="sm:hidden"> · v2.0 公務版</span>
        </div>
      </footer>
    </div>
  );
}

render(<App />, document.getElementById('app')!);
