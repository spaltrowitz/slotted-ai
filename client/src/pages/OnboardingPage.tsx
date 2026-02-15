import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface OnboardingData {
  socialFrequency: string;
  socialGoal: string;
  preferredTimes: string[];
  preferredDuration: string;
  preferredCallDuration: string;
  personalTimeMode: string;
  tripBuffer: string;
  calendarConnected: boolean;
}

const steps = [
  'frequency',
  'social-goal',
  'times',
  'hangout-duration',
  'call-duration',
  'personal-time',
  'trip-buffer',
  'calendar',
] as const;

export default function OnboardingPage() {
  const { user, clearNewUser, completeOnboarding, skipOnboarding, connectCalendar, calendarConnected } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<OnboardingData>({
    socialFrequency: '',
    socialGoal: '',
    preferredTimes: [],
    preferredDuration: '',
    preferredCallDuration: '',
    personalTimeMode: '',
    tripBuffer: '',
    calendarConnected: false,
  });

  const currentStep = steps[step];

  const next = () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      // TODO: POST onboarding data to API
      console.log('Onboarding complete:', data);
      clearNewUser();
      completeOnboarding();
      navigate('/dashboard');
    }
  };

  const handleSkip = () => {
    skipOnboarding();
    navigate('/dashboard');
  };

  const back = () => {
    if (step > 0) setStep(step - 1);
  };

  const stepEmojis = ['🗓️', '🎯', '🌅', '⏱️', '📞', '🛡️', '✈️', '📅'];

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

        {/* Q1: Social Frequency */}
        {currentStep === 'frequency' && (
          <div className="space-y-4">
            <h2 className="font-display text-xl font-bold text-gray-900">
              Hey {user?.displayName?.split(' ')[0]}! 👋 How often do you like to
              see people you care about?
            </h2>
            <div className="space-y-2">
              {[
                { value: 'daily', label: 'Almost every day' },
                { value: '2-3-week', label: '2–3 times a week' },
                { value: 'weekly', label: 'About once a week' },
                { value: '2-3-month', label: '2–3 times a month' },
                { value: 'rarely', label: 'Less often' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() =>
                    setData({ ...data, socialFrequency: opt.value })
                  }
                  className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition-all ${
                    data.socialFrequency === opt.value
                      ? 'border-slotted-400 bg-gradient-to-r from-slotted-50 to-purple-50 text-slotted-700 shadow-sm'
                      : 'border-gray-200 text-gray-700 hover:border-slotted-200 hover:bg-gray-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Q2: Social Goal */}
        {currentStep === 'social-goal' && (
          <div className="space-y-4">
            <h2 className="font-display text-xl font-bold text-gray-900">
              What's your social goal right now?
            </h2>
            <p className="text-sm text-gray-500">
              This helps us calibrate how often we suggest getting together
            </p>
            <div className="space-y-2">
              {[
                { value: 'increase', label: '📈 I want to see people more often' },
                { value: 'maintain', label: '⚖️ I\'m happy with my current pace' },
                { value: 'decrease', label: '📉 I want a bit more downtime' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() =>
                    setData({ ...data, socialGoal: opt.value })
                  }
                  className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition-all ${
                    data.socialGoal === opt.value
                      ? 'border-slotted-400 bg-gradient-to-r from-slotted-50 to-purple-50 text-slotted-700 shadow-sm'
                      : 'border-gray-200 text-gray-700 hover:border-slotted-200 hover:bg-gray-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Q3: Preferred Times */}
        {currentStep === 'times' && (
          <div className="space-y-4">
            <h2 className="font-display text-xl font-bold text-gray-900">
              When do you usually hang out?
            </h2>
            <p className="text-sm text-gray-500">Select all that apply</p>
            <div className="grid grid-cols-2 gap-2">
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
                    className={`rounded-xl border px-4 py-3 text-left text-sm transition-all ${
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
          </div>
        )}

        {/* Q4: Hangout Duration */}
        {currentStep === 'hangout-duration' && (
          <div className="space-y-4">
            <h2 className="font-display text-xl font-bold text-gray-900">
              How long are your in-person hangouts?
            </h2>
            <p className="text-sm text-gray-500">
              We'll look for windows that fit your style
            </p>
            <div className="space-y-2">
              {[
                { value: 'quick', label: '⚡ Quick catch-up (30–60 min)' },
                { value: 'medium', label: '☕ A couple hours (1–2 hrs)' },
                { value: 'long', label: '🍽️ A good stretch (2–4 hrs)' },
                { value: 'half-day', label: '🎉 Half-day or more (4+ hrs)' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() =>
                    setData({ ...data, preferredDuration: opt.value })
                  }
                  className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition-all ${
                    data.preferredDuration === opt.value
                      ? 'border-slotted-400 bg-gradient-to-r from-slotted-50 to-purple-50 text-slotted-700 shadow-sm'
                      : 'border-gray-200 text-gray-700 hover:border-slotted-200 hover:bg-gray-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Q5: Call / FaceTime Duration */}
        {currentStep === 'call-duration' && (
          <div className="space-y-4">
            <h2 className="font-display text-xl font-bold text-gray-900">
              How about calls & FaceTime?
            </h2>
            <p className="text-sm text-gray-500">
              For long-distance friends & family — how long do your calls usually last?
            </p>
            <div className="space-y-2">
              {[
                { value: 'quick', label: '💬 Quick check-in (10–20 min)' },
                { value: 'medium', label: '📱 A solid call (30–60 min)' },
                { value: 'long', label: '📞 A real catch-up (1–2 hrs)' },
                { value: 'none', label: '🙅 I don\'t really do calls' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() =>
                    setData({ ...data, preferredCallDuration: opt.value })
                  }
                  className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition-all ${
                    data.preferredCallDuration === opt.value
                      ? 'border-slotted-400 bg-gradient-to-r from-slotted-50 to-purple-50 text-slotted-700 shadow-sm'
                      : 'border-gray-200 text-gray-700 hover:border-slotted-200 hover:bg-gray-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Q6: Protect Personal Time */}
        {currentStep === 'personal-time' && (
          <div className="space-y-4">
            <h2 className="font-display text-xl font-bold text-gray-900">
              How do you want to protect personal time?
            </h2>
            <p className="text-sm text-gray-500">
              Sometimes you're technically free but don't want plans
            </p>
            <div className="space-y-2">
              {[
                { value: 'manual', label: '🔧 I\'ll manually mark blocks as unavailable' },
                { value: 'recurring', label: '🔁 Help me set up recurring protected time' },
                { value: 'open', label: '📖 I\'m comfortable showing all my free time' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() =>
                    setData({ ...data, personalTimeMode: opt.value })
                  }
                  className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition-all ${
                    data.personalTimeMode === opt.value
                      ? 'border-slotted-400 bg-gradient-to-r from-slotted-50 to-purple-50 text-slotted-700 shadow-sm'
                      : 'border-gray-200 text-gray-700 hover:border-slotted-200 hover:bg-gray-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Q6: Trip Buffers */}
        {currentStep === 'trip-buffer' && (
          <div className="space-y-4">
            <h2 className="font-display text-xl font-bold text-gray-900">
              Auto-block time around trips? ✈️
            </h2>
            <p className="text-sm text-gray-500">
              When we detect travel on your calendar, we can buffer recovery time
            </p>
            <div className="space-y-2">
              {[
                { value: 'before', label: 'Block the day before travel' },
                { value: 'after', label: 'Block the day after travel' },
                { value: 'both', label: 'Block both before and after' },
                { value: 'none', label: 'No buffers — I\'m always available' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() =>
                    setData({ ...data, tripBuffer: opt.value })
                  }
                  className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition-all ${
                    data.tripBuffer === opt.value
                      ? 'border-slotted-400 bg-gradient-to-r from-slotted-50 to-purple-50 text-slotted-700 shadow-sm'
                      : 'border-gray-200 text-gray-700 hover:border-slotted-200 hover:bg-gray-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Q7: Calendar connect */}
        {currentStep === 'calendar' && (
          <div className="space-y-4">
            <h2 className="font-display text-xl font-bold text-gray-900">
              Connect your Google Calendar
            </h2>
            <p className="text-sm text-gray-500">
              We only read your busy/free times — never event details
            </p>
            <p className="text-xs text-amber-600 font-medium">
              ⚠️ When Google asks for permissions, please make sure to select all 3 checkboxes so Slotted can work properly.
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
              className="rounded-xl gradient-btn px-6 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:shadow-lg hover:-translate-y-0.5"
            >
              {step === steps.length - 1 ? 'Let\'s go! \uD83D\uDE80' : 'Continue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
