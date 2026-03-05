import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';
import { queryKeys } from '../lib/queries';

export default function OnboardingPage() {
  const { user, clearNewUser, completeOnboarding, skipOnboarding, connectCalendar, calendarConnected } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const onboardingMutation = useMutation({
    mutationFn: async () => {
      await api.post('/users/me/onboarding', {
        preferredTimes: [],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings });
    },
  });

  const saving = onboardingMutation.isPending;

  const finishOnboarding = async () => {
    try {
      await onboardingMutation.mutateAsync();
    } catch (err) {
      console.error('Failed to save onboarding:', err);
    }
    clearNewUser();
    completeOnboarding();
    navigate('/dashboard');
  };

  const handleSkip = () => {
    skipOnboarding();
    navigate('/dashboard');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-white relative overflow-hidden">
      <div className="absolute -top-1/3 -right-1/4 h-[800px] w-[800px] rounded-full bg-gradient-to-br from-orange-100/60 via-rose-50/40 to-transparent blur-3xl" />
      <div className="absolute -bottom-1/4 -left-1/4 h-[600px] w-[600px] rounded-full bg-gradient-to-tr from-blue-50/50 via-indigo-50/30 to-transparent blur-3xl" />

      <div className="relative w-full max-w-lg rounded-2xl bg-white p-8 shadow-xl border border-gray-200/60">
        <div className="space-y-5">
          <div>
            <h2 className="font-display text-xl font-bold text-gray-900">
              Hey {user?.displayName?.split(' ')[0]}! Let's get started.
            </h2>
            <p className="mt-2 text-sm text-gray-500 leading-relaxed">
              Connect your calendar to get started. Slotted finds times when you and your friends are both free.
            </p>
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3 space-y-1.5">
            <p className="text-xs font-medium text-blue-800">Your calendar is private</p>
            <p className="text-[11px] text-blue-700 leading-relaxed">
              Friends only see when you're <strong>free or busy</strong> — never what you're doing. You choose which calendars to share, and you can disconnect anytime.
            </p>
          </div>

          <p className="text-xs text-amber-600 font-medium">
            ⚠️ When Google asks for permissions, please make sure to select all 3 checkboxes so Slotted.ai can work properly.
          </p>

          {calendarConnected ? (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-center">
              <span className="text-2xl">✅</span>
              <p className="mt-2 font-medium text-green-700">
                Calendar connected!
              </p>
            </div>
          ) : (
            <button
              onClick={() => connectCalendar()}
              className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-6 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Connect Google Calendar
            </button>
          )}
        </div>

        <div className="mt-8 flex items-center justify-end gap-3">
          <button
            onClick={handleSkip}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-gray-400 hover:text-gray-600 transition-colors"
          >
            Skip for now
          </button>
          {calendarConnected && (
            <button
              onClick={finishOnboarding}
              disabled={saving}
              className="rounded-xl gradient-btn px-6 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:shadow-lg hover:-translate-y-0.5 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Continue'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
