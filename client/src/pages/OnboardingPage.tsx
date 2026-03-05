import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';
import { queryKeys } from '../lib/queries';

interface OnboardingData {
  preferredTimes: string[];
  city: string;
}

const steps = [
  'calendar',
  'city',
  'times',
] as const;

export default function OnboardingPage() {
  const { user, clearNewUser, completeOnboarding, skipOnboarding, connectCalendar, calendarConnected } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<OnboardingData>({
    preferredTimes: [],
    city: '',
  });

  const onboardingMutation = useMutation({
    mutationFn: async (payload: { preferredTimes: string[]; city: string }) => {
      await api.post('/users/me/onboarding', {
        preferredTimes: payload.preferredTimes,
        ...(payload.city.trim() && { neighborhood: payload.city.trim() }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings });
    },
  });

  const saving = onboardingMutation.isPending;

  const currentStep = steps[step];

  const finishOnboarding = async () => {
    try {
      await onboardingMutation.mutateAsync({ preferredTimes: data.preferredTimes, city: data.city });
    } catch (err) {
      console.error('Failed to save onboarding:', err);
    }
    clearNewUser();
    completeOnboarding();
    navigate('/dashboard');
  };

  const next = () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      finishOnboarding();
    }
  };

  const handleSkip = () => {
    skipOnboarding();
    navigate('/dashboard');
  };

  const back = () => {
    if (step > 0) setStep(step - 1);
  };

  const stepEmojis = ['📅', '🏙️', '🌅'];

  return (
    <div className="flex min-h-screen items-center justify-center bg-white relative overflow-hidden">
      {/* Soft gradient wash — matching login */}
      <div className="absolute -top-1/3 -right-1/4 h-[800px] w-[800px] rounded-full bg-gradient-to-br from-orange-100/60 via-rose-50/40 to-transparent blur-3xl" />
      <div className="absolute -bottom-1/4 -left-1/4 h-[600px] w-[600px] rounded-full bg-gradient-to-tr from-blue-50/50 via-indigo-50/30 to-transparent blur-3xl" />

      <div className="relative w-full max-w-lg rounded-2xl bg-white p-8 shadow-xl border border-gray-200/60">
        {/* Progress */}
        <div className="mb-6 flex gap-1.5">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-2 flex-1 rounded-full transition-all duration-300 ${
                i <= step
                  ? 'gradient-btn'
                  : 'bg-gray-200'
              }`}
            />
          ))}
        </div>

        <div className="mb-2 flex items-center gap-2">
          <span className="text-lg">{stepEmojis[step]}</span>
          <p className="text-sm text-gray-400">
            Step {step + 1} of {steps.length}
          </p>
        </div>

        {/* Step 1: Calendar connect */}
        {currentStep === 'calendar' && (
          <div className="space-y-4">
            <h2 className="font-display text-xl font-bold text-gray-900">
              Hey {user?.displayName?.split(' ')[0]}! 👋 Let's get Slotted.ai working for you
            </h2>
            <p className="text-sm text-gray-500">
              Connect your calendar so we can find the best times to hang out with friends. We only read busy/free — never event titles or details.
            </p>
            <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3 space-y-1.5">
              <p className="text-xs font-medium text-blue-800">🔒 Your calendar is private</p>
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
        )}

        {/* Step 2: City */}
        {currentStep === 'city' && (
          <div className="space-y-4">
            <h2 className="font-display text-xl font-bold text-gray-900">
              What city do you live in?
            </h2>
            <p className="text-sm text-gray-500">
              This helps us figure out which friends are nearby vs. long-distance, so we can suggest the right kind of hangout.
            </p>
            <input
              type="text"
              value={data.city}
              onChange={(e) => setData({ ...data, city: e.target.value })}
              placeholder="e.g. New York, Los Angeles, Chicago"
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-slotted-400 focus:outline-none focus:ring-2 focus:ring-slotted-100 transition-all"
            />
            <p className="text-xs text-gray-400">
              You can always change this later in Settings.
            </p>
          </div>
        )}

        {/* Step 3: Preferred Times */}
        {currentStep === 'times' && (
          <div className="space-y-4">
            <h2 className="font-display text-xl font-bold text-gray-900">
              When do you usually hang out?
            </h2>
            <p className="text-sm text-gray-500">Select all that apply — this helps Slotted.ai suggest the best times</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { value: 'weekday-morning', emoji: '🌅', prefix: 'Weekday', suffix: 'mornings' },
                { value: 'weekday-lunch', emoji: '☀️', prefix: 'Weekday', suffix: 'lunches' },
                { value: 'weekday-evening', emoji: '🌆', prefix: 'Weekday', suffix: 'evenings' },
                { value: 'weekend-morning', emoji: '🥐', prefix: 'Weekend', suffix: 'mornings' },
                { value: 'weekend-afternoon', emoji: '🏖️', prefix: 'Weekend', suffix: 'afternoons' },
                { value: 'weekend-evening', emoji: '🌙', prefix: 'Weekend', suffix: 'evenings' },
              ].map((opt) => {
                const selected = data.preferredTimes.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    onClick={() =>
                      setData({
                        ...data,
                        preferredTimes: selected
                          ? data.preferredTimes.filter((t) => t !== opt.value)
                          : [...data.preferredTimes, opt.value],
                      })
                    }
                    className={`rounded-xl border px-4 py-3.5 text-left text-sm transition-all ${
                      selected
                        ? 'border-slotted-400 bg-gradient-to-r from-slotted-50 to-purple-50 text-slotted-700 shadow-sm'
                        : 'border-gray-200 text-gray-700 hover:border-slotted-200 hover:bg-gray-50'
                    }`}
                  >
                    {opt.emoji} <span className="font-bold">{opt.prefix}</span> {opt.suffix}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-gray-400">
              You can fine-tune all scheduling preferences in Settings anytime.
            </p>
          </div>
        )}

        {/* Navigation buttons */}
        <div className="mt-8 flex items-center justify-between">
          <button
            onClick={back}
            disabled={step === 0}
            className="rounded-xl px-6 py-2.5 text-sm font-medium text-gray-400 hover:text-gray-700 transition-colors disabled:invisible"
          >
            Back
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSkip}
              className="rounded-xl px-4 py-2.5 text-sm font-medium text-gray-400 hover:text-gray-600 transition-colors"
            >
              Skip for now
            </button>
            <button
              onClick={next}
              disabled={saving}
              className="rounded-xl gradient-btn px-6 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:shadow-lg hover:-translate-y-0.5 disabled:opacity-50"
            >
              {saving ? 'Saving...' : step === steps.length - 1 ? 'Let\'s go! \uD83D\uDE80' : 'Continue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
