import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

type BatteryLevel = 'open' | 'ask_me' | 'recharging';

interface OnboardingData {
  socialFrequency: string;
  preferredTimes: string[];
  travelBuffer: string;
  socialBattery: BatteryLevel;
  calendarConnected: boolean;
}

const steps = [
  'frequency',
  'times',
  'travel',
  'battery',
  'calendar',
] as const;

export default function OnboardingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<OnboardingData>({
    socialFrequency: '',
    preferredTimes: [],
    travelBuffer: '30',
    socialBattery: 'open',
    calendarConnected: false,
  });

  const currentStep = steps[step];

  const next = () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      // TODO: POST onboarding data to API
      console.log('Onboarding complete:', data);
      navigate('/dashboard');
    }
  };

  const back = () => {
    if (step > 0) setStep(step - 1);
  };

  const stepEmojis = ['🗓️', '🌅', '🚗', '🔋', '📅'];

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#faf9f7] relative overflow-hidden">
      {/* Decorative geometric shapes — crisp, matching login */}
      <div className="absolute top-16 left-20 h-28 w-28 rounded-full bg-teal-400/12" />
      <div className="absolute bottom-24 right-16 h-36 w-36 rounded-full bg-amber-300/15" />
      <div className="absolute top-1/3 right-1/4 h-14 w-14 rounded-2xl rotate-12 bg-indigo-400/10" />

      {/* Subtle dot grid */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: 'radial-gradient(circle, #000 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

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
              see friends?
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

        {/* Q2: Preferred Times */}
        {currentStep === 'times' && (
          <div className="space-y-4">
            <h2 className="font-display text-xl font-bold text-gray-900">
              When do you usually hang out?
            </h2>
            <p className="text-sm text-gray-500">Select all that apply</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'weekday-morning', label: '🌅 Weekday mornings' },
                { value: 'weekday-lunch', label: '☀️ Weekday lunches' },
                { value: 'weekday-evening', label: '🌆 Weekday evenings' },
                { value: 'weekend-morning', label: '🥐 Weekend mornings' },
                { value: 'weekend-afternoon', label: '🏖️ Weekend afternoons' },
                { value: 'weekend-evening', label: '🌙 Weekend evenings' },
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
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Q3: Travel Buffer */}
        {currentStep === 'travel' && (
          <div className="space-y-4">
            <h2 className="font-display text-xl font-bold text-gray-900">
              How much travel buffer do you need?
            </h2>
            <p className="text-sm text-gray-500">
              We'll pad your meetup times so you're never rushing 🏃‍♀️
            </p>
            <div className="space-y-2">
              {[
                { value: '15', label: '15 minutes' },
                { value: '30', label: '30 minutes' },
                { value: '45', label: '45 minutes' },
                { value: '60', label: '1 hour' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() =>
                    setData({ ...data, travelBuffer: opt.value })
                  }
                  className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition-all ${
                    data.travelBuffer === opt.value
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

        {/* Q4: Social Battery Default */}
        {currentStep === 'battery' && (
          <div className="space-y-4">
            <h2 className="font-display text-xl font-bold text-gray-900">
              What's your usual social energy level?
            </h2>
            <p className="text-sm text-gray-500">
              You can change this anytime from your dashboard
            </p>
            <div className="space-y-3">
              {[
                {
                  value: 'open' as BatteryLevel,
                  emoji: '🟢',
                  label: 'Open',
                  desc: "I'm usually down to hang out",
                },
                {
                  value: 'ask_me' as BatteryLevel,
                  emoji: '🟡',
                  label: 'Ask Me',
                  desc: "Depends on the plan and who's going",
                },
                {
                  value: 'recharging' as BatteryLevel,
                  emoji: '🔴',
                  label: 'Recharging',
                  desc: 'I prefer alone time by default',
                },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() =>
                    setData({ ...data, socialBattery: opt.value })
                  }
                  className={`w-full rounded-xl border px-4 py-3 text-left transition-all ${
                    data.socialBattery === opt.value
                      ? 'border-slotted-400 bg-gradient-to-r from-slotted-50 to-purple-50 shadow-sm'
                      : 'border-gray-200 hover:border-slotted-200 hover:bg-gray-50'
                  }`}
                >
                  <span className="text-lg">{opt.emoji}</span>{' '}
                  <span className="font-medium text-gray-900">{opt.label}</span>
                  <p className="mt-0.5 text-sm text-gray-500">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Q5: Calendar connect */}
        {currentStep === 'calendar' && (
          <div className="space-y-4">
            <h2 className="font-display text-xl font-bold text-gray-900">
              Connect your Google Calendar
            </h2>
            <p className="text-sm text-gray-500">
              We only read your busy/free times — never event details
            </p>
            {data.calendarConnected ? (
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-center">
                <span className="text-2xl">✅</span>
                <p className="mt-2 font-medium text-green-700">
                  Calendar connected!
                </p>
              </div>
            ) : (
              <button
                onClick={() =>
                  // TODO: trigger Google Calendar OAuth flow
                  setData({ ...data, calendarConnected: true })
                }
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
        <div className="mt-8 flex justify-between">
          <button
            onClick={back}
            disabled={step === 0}
            className="rounded-xl px-6 py-2.5 text-sm font-medium text-gray-400 hover:text-gray-700 transition-colors disabled:invisible"
          >
            Back
          </button>
          <button
            onClick={next}
            className="rounded-xl gradient-btn px-6 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:shadow-lg hover:-translate-y-0.5"
          >
            {step === steps.length - 1 ? 'Let\'s go! 🚀' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
