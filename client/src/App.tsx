import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Component, Suspense, lazy, type ReactNode } from 'react';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

function lazyWithRetry<T extends React.ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
  chunkKey: string,
) {
  return lazy(async () => {
    try {
      return await importer();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isChunkLoadError =
        message.includes('Failed to fetch dynamically imported module') ||
        message.includes('Importing a module script failed');
      const reloadKey = `slotted_chunk_retry_${chunkKey}`;
      if (isChunkLoadError && sessionStorage.getItem(reloadKey) !== '1') {
        sessionStorage.setItem(reloadKey, '1');
        window.location.reload();
      }
      throw error;
    }
  });
}

const LoginPage = lazyWithRetry(() => import('./pages/LoginPage'), 'login');
const DashboardPage = lazyWithRetry(() => import('./pages/DashboardPage'), 'dashboard');
const FriendsPage = lazyWithRetry(() => import('./pages/FriendsPage'), 'friends');
const OnboardingPage = lazyWithRetry(() => import('./pages/OnboardingPage'), 'onboarding');
const SettingsPage = lazyWithRetry(() => import('./pages/SettingsPage'), 'settings');
const NotificationsPage = lazyWithRetry(() => import('./pages/NotificationsPage'), 'notifications');

const PrivacyPolicyPage = lazyWithRetry(() => import('./pages/PrivacyPolicyPage'), 'privacy');
const TermsOfServicePage = lazyWithRetry(() => import('./pages/TermsOfServicePage'), 'terms');
const InvitePage = lazyWithRetry(() => import('./pages/InvitePage'), 'invite');
const EventSharePage = lazyWithRetry(() => import('./pages/EventSharePage'), 'event-share');
const HelpPage = lazyWithRetry(() => import('./pages/HelpPage'), 'help');

// Prefetch the dashboard chunk after initial page load
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    const prefetch = () => { import('./pages/DashboardPage').catch(() => {}); };
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(prefetch);
    } else {
      setTimeout(prefetch, 2000);
    }
  }, { once: true });
}

/* ─── Error boundary ─── */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('App crash:', error, info.componentStack);
    // Also log to a visible place so users can report it
    try {
      const existing = sessionStorage.getItem('slotted_crash_log') || '';
      sessionStorage.setItem('slotted_crash_log', existing + '\n' + error.message + '\n' + error.stack);
    } catch { /* ignore */ }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen items-center justify-center bg-gray-50 p-8">
          <div className="max-w-md text-center">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Something went wrong</h2>
            <p className="text-sm text-gray-500 mb-4">{this.state.error.message}</p>
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
              className="rounded-xl bg-gradient-to-r from-purple-500 to-blue-500 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:shadow-md transition-all"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60 * 2, retry: 1 },
  },
});

function RouteLoadingFallback() {
  return (
    <div className="flex h-screen items-center justify-center bg-[#faf9f7]">
      <div className="w-full max-w-md px-6 space-y-5 animate-pulse">
        <div className="space-y-2">
          <div className="h-6 w-40 rounded-lg bg-gray-200/60" />
          <div className="h-4 w-28 rounded-lg bg-gray-100" />
        </div>
        <div className="rounded-2xl border border-gray-100 bg-white p-4 space-y-3">
          <div className="h-4 w-28 rounded bg-gray-200/60" />
          <div className="h-20 rounded-xl bg-gray-100" />
        </div>
        <div className="flex gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <div className="h-10 w-10 rounded-full bg-gray-200/60" />
              <div className="h-3 w-14 rounded bg-gray-100" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<RouteLoadingFallback />}>
            <Routes>
              <Route path="/" element={<LoginPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/privacy" element={<PrivacyPolicyPage />} />
              <Route path="/terms" element={<TermsOfServicePage />} />
              <Route path="/invite/:code" element={<InvitePage />} />
              <Route path="/e/:code" element={<EventSharePage />} />

              {/* Protected routes */}
              <Route element={<ProtectedRoute />}>
                <Route path="/onboarding" element={<OnboardingPage />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/friends" element={<FriendsPage />} />

                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/help" element={<HelpPage />} />
              </Route>

              {/* Catch-all */}
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
    </ErrorBoundary>
  );
}
