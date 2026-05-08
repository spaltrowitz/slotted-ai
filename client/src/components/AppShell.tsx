import { Link, useLocation } from 'react-router-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { fetchNotifications, queryKeys } from '../lib/queries';
import NotificationDropdown from './NotificationDropdown';
import FeedbackButton from './FeedbackButton';

const bottomNavItems = [
  {
    path: '/dashboard',
    label: 'Home',
    icon: (
      <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
      </svg>
    ),
  },
  {
    path: '/settings',
    label: 'Settings',
    icon: (
      <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

const desktopNavItems = bottomNavItems;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const touchStartY = useRef<number | null>(null);
  const pullDistance = useRef(0);
  const isPulling = useRef(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  const { data: notifications = [] } = useQuery({
    queryKey: queryKeys.notifications,
    queryFn: fetchNotifications,
    enabled: !!user,
  });
  const unreadCount = notifications.filter((n) => !n.read).length;

  const closeNotifications = useCallback(() => setNotificationsOpen(false), []);

  useEffect(() => {
    if (typeof window === 'undefined' || !('ontouchstart' in window)) return;

    const onTouchStart = (e: TouchEvent) => {
      if (window.scrollY > 0) {
        isPulling.current = false;
        return;
      }
      touchStartY.current = e.touches[0]?.clientY ?? null;
      pullDistance.current = 0;
      isPulling.current = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isPulling.current || touchStartY.current === null || window.scrollY > 0) return;
      const currentY = e.touches[0]?.clientY ?? touchStartY.current;
      const delta = currentY - touchStartY.current;
      if (delta <= 0) {
        pullDistance.current = 0;
        return;
      }
      pullDistance.current = Math.min(delta, 140);
      if (delta > 10) {
        e.preventDefault();
      }
    };

    const onTouchEnd = () => {
      if (isPulling.current && window.scrollY <= 0 && pullDistance.current > 90) {
        window.location.reload();
      }
      touchStartY.current = null;
      pullDistance.current = 0;
      isPulling.current = false;
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-page-warm font-sans">
      {/* Subtle background washes */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 right-0 h-[500px] w-[500px] rounded-full bg-gradient-to-br from-amber-100/30 via-orange-100/20 to-transparent blur-3xl" />
        <div className="absolute top-1/3 -left-32 h-[400px] w-[400px] rounded-full bg-gradient-to-tr from-teal-100/25 via-cyan-50/20 to-transparent blur-3xl" />
        <div className="absolute bottom-0 right-1/4 h-[350px] w-[350px] rounded-full bg-gradient-to-tl from-violet-100/20 via-fuchsia-50/15 to-transparent blur-3xl" />
      </div>

      {/* Top navigation bar */}
      <header className="sticky top-0 z-50 border-b border-gray-200/80 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          {/* Left — logo + desktop nav */}
          <div className="flex items-center gap-8">
            <Link to="/" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-btn">
                <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <span className="font-display text-lg font-bold text-gray-900">Slotted.ai</span>
            </Link>

            {/* Desktop nav — Home, Friends, Settings */}
            <nav className="hidden md:flex items-center gap-1">
              {desktopNavItems.map((item) => {
                const isActive = location.pathname.startsWith(item.path);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`relative flex items-center gap-2 rounded-lg px-3 py-2.5 min-h-[44px] text-sm font-medium transition-all ${
                      isActive
                        ? 'bg-slotted-50 text-slotted-700'
                        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                    }`}
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right — bell icon, profile/settings icon */}
          <div className="flex items-center gap-2">
            {/* Bell icon — notifications dropdown trigger */}
            <div className="relative">
              <button
                onClick={() => setNotificationsOpen(!notificationsOpen)}
                aria-label="Notifications"
                className="relative rounded-lg p-3 min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                </svg>
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              <NotificationDropdown open={notificationsOpen} onClose={closeNotifications} />
            </div>

            {/* Profile menu dropdown */}
            <div className="relative">
              <button
                onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                aria-label="Profile menu"
                className="cursor-pointer rounded-full p-1 -m-1"
              >
                {user?.photoURL ? (
                  <img src={user.photoURL} alt="" className="h-8 w-8 rounded-full ring-2 ring-slotted-100 transition-opacity hover:opacity-80" loading="lazy" />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full gradient-btn text-xs font-bold text-white transition-opacity hover:opacity-80">
                    {user?.displayName?.[0] ?? '?'}
                  </div>
                )}
              </button>
              {profileMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setProfileMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 z-50 w-44 rounded-xl border border-gray-200/80 bg-white py-1 shadow-lg">
                    <Link
                      to="/settings"
                      onClick={() => setProfileMenuOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      Settings
                    </Link>
                    <div className="mx-3 my-1 border-t border-gray-100" />
                    <button
                      onClick={async () => { setProfileMenuOpen(false); await signOut(); }}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <svg className="h-4 w-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                      </svg>
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main content — extra bottom padding on mobile for tab bar */}
      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-4 py-6 pb-28 sm:px-6 sm:py-8 md:pb-8">{children}</div>
      </main>

      <FeedbackButton />

      {/* Mobile bottom tab bar — 2 tabs: Home + Settings */}
      <nav className="fixed bottom-0 inset-x-0 z-50 border-t border-gray-200/80 bg-white/95 backdrop-blur-xl md:hidden">
        <div className="mx-auto flex h-16 max-w-lg items-center justify-around px-1">
          {bottomNavItems.map((item) => {
            const isActive = location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 transition-all ${
                  isActive
                    ? 'text-slotted-600'
                    : 'text-gray-400'
                }`}
              >
                <span className="h-6 w-6 [&>svg]:h-6 [&>svg]:w-6">{item.icon}</span>
                <span className="max-w-full truncate px-0.5 text-[11px] font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
        {/* Safe area for phones with home indicator */}
        <div className="h-[env(safe-area-inset-bottom)]" />
      </nav>
    </div>
  );
}
