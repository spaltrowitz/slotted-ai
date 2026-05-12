import { useEffect, useMemo, useState } from 'react';
import api from '../lib/api';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

type Person = {
  userId: string;
  name: string;
  photoUrl?: string | null;
};

type Showtime = {
  datetime: string;
  location?: string | null;
};

interface SettlePollModalProps {
  scheduleId: string;
  eventTitle: string;
  eventVenue?: string | null;
  showtimes: Showtime[];
  voted: (Person & { selectedCount: number; votedAt: string })[];
  pending: Person[];
  currentUserId: string;
  onClose: () => void;
  onSettled: () => void;
}

type Step = 'date' | 'recipients' | 'confirm';

function formatShowtime(datetime: string): string {
  try {
    const d = new Date(datetime);
    if (Number.isNaN(d.getTime())) return datetime;
    return d.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return datetime;
  }
}

function defaultCustomDatetime(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(19, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function splitDatetime(value: string): { date: string; time: string } {
  const [date = '', time = ''] = value.split('T');
  return { date, time };
}

function combineDatetime(date: string, time: string): string {
  if (!date || !time) return '';
  return `${date}T${time}`;
}

export default function SettlePollModal({
  scheduleId,
  eventTitle,
  eventVenue,
  showtimes,
  voted,
  pending,
  currentUserId,
  onClose,
  onSettled,
}: SettlePollModalProps) {
  useBodyScrollLock(true);
  const [step, setStep] = useState<Step>('date');
  const [showtimeIndex, setShowtimeIndex] = useState<number | null>(null);
  const [useCustom, setUseCustom] = useState(false);
  const defaultDateTime = splitDatetime(defaultCustomDatetime());
  const [customDate, setCustomDate] = useState<string>(defaultDateTime.date);
  const [customTime, setCustomTime] = useState<string>(defaultDateTime.time);
  const [customLocation, setCustomLocation] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const voterIds = useMemo(() => new Set(voted.map((v) => v.userId)), [voted]);
  const allParticipants: Person[] = useMemo(
    () => [...voted.map((v) => ({ userId: v.userId, name: v.name, photoUrl: v.photoUrl })), ...pending],
    [voted, pending],
  );

  // Default: everyone who voted + the owner (themself). Non-voters unchecked.
  const [selectedRecipients, setSelectedRecipients] = useState<Set<string>>(() => {
    const init = new Set<string>();
    for (const p of allParticipants) {
      if (p.userId === currentUserId || voterIds.has(p.userId)) init.add(p.userId);
    }
    return init;
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const toggleRecipient = (userId: string) => {
    setSelectedRecipients((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  };

  const checkVoters = () => {
    setSelectedRecipients(new Set(voted.map((v) => v.userId).concat([currentUserId])));
  };
  const checkAll = () => {
    setSelectedRecipients(new Set(allParticipants.map((p) => p.userId)));
  };

  const customDatetime = combineDatetime(customDate, customTime);
  const dateStepValid = useCustom ? customDatetime.length > 0 : showtimeIndex !== null;
  const recipientStepValid = selectedRecipients.size > 0;

  const selectedDateLabel = useCustom
    ? customDatetime ? formatShowtime(customDatetime) : '—'
    : showtimeIndex !== null && showtimes[showtimeIndex]
      ? formatShowtime(showtimes[showtimeIndex].datetime)
      : '—';

  const finalVenue = useCustom && customLocation.trim() ? customLocation.trim() : eventVenue;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const body: {
        recipientUserIds: string[];
        timeZone?: string;
        customDatetime?: string;
        customLocation?: string;
        showtimeIndex?: number | null;
      } = {
        recipientUserIds: Array.from(selectedRecipients),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      if (useCustom) {
        body.customDatetime = customDatetime;
        if (customLocation.trim()) body.customLocation = customLocation.trim();
      } else {
        body.showtimeIndex = showtimeIndex;
      }
      await api.post(`/events/schedules/${scheduleId}/settle`, body);
      onSettled();
      onClose();
    } catch (err: unknown) {
      const shaped = err as { response?: { data?: { error?: unknown } }; message?: unknown };
      const responseError = shaped.response?.data?.error;
      setError(
        (typeof responseError === 'string' && responseError) ||
        (typeof shaped.message === 'string' && shaped.message) ||
        'Could not settle this poll.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-0 sm:px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900 truncate">Choose a date</h2>
            <p className="text-xs text-gray-500 truncate">{eventTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-3 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-1 px-5 pt-3">
          {(['date', 'recipients', 'confirm'] as Step[]).map((s, i) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full ${
                step === s
                  ? 'bg-sky-500'
                  : ['date', 'recipients', 'confirm'].indexOf(step) > i
                    ? 'bg-sky-300'
                    : 'bg-gray-200'
              }`}
            />
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {step === 'date' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-700">Pick the final date for this hangout.</p>
              <div className="space-y-2">
                {showtimes.map((st, idx) => {
                  const isSelected = !useCustom && showtimeIndex === idx;
                  return (
                    <button
                      key={`${st.datetime}-${idx}`}
                      type="button"
                      onClick={() => { setUseCustom(false); setShowtimeIndex(idx); }}
                      className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
                        isSelected
                          ? 'border-sky-500 bg-sky-50 text-sky-900'
                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <span className="font-medium">{formatShowtime(st.datetime)}</span>
                      {isSelected && <span className="text-sky-600">✓</span>}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => { setUseCustom(true); setShowtimeIndex(null); }}
                  className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
                    useCustom
                      ? 'border-sky-500 bg-sky-50 text-sky-900'
                      : 'border-dashed border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <span className="font-medium">+ Use a different date/time</span>
                  {useCustom && <span className="text-sky-600">✓</span>}
                </button>
                {useCustom && (
                  <div className="space-y-2 rounded-xl border border-sky-100 bg-sky-50/50 p-3">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label className="block text-xs font-medium text-gray-700">
                        Date
                        <input
                          type="date"
                          value={customDate}
                          onChange={(e) => setCustomDate(e.target.value)}
                          className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
                        />
                      </label>
                      <label className="block text-xs font-medium text-gray-700">
                        Time
                        <input
                          type="time"
                          value={customTime}
                          onChange={(e) => setCustomTime(e.target.value)}
                          className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
                        />
                      </label>
                    </div>
                    <label className="block text-xs font-medium text-gray-700">
                      Location <span className="text-gray-400 font-normal">(optional)</span>
                      <input
                        type="text"
                        value={customLocation}
                        onChange={(e) => setCustomLocation(e.target.value)}
                        placeholder={eventVenue || 'e.g. Palace Theatre'}
                        className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
                      />
                    </label>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 'recipients' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-700">Who should hear about this?</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={checkVoters}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  Just voters
                </button>
                <button
                  type="button"
                  onClick={checkAll}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  Everyone
                </button>
              </div>
              <div className="space-y-1.5">
                {allParticipants.map((p) => {
                  const checked = selectedRecipients.has(p.userId);
                  const isYou = p.userId === currentUserId;
                  const voteState = voterIds.has(p.userId) ? '✅ voted' : '⏳ pending';
                  return (
                    <label
                      key={p.userId}
                      className={`flex min-h-[44px] cursor-pointer items-center justify-between rounded-xl border px-3 py-2 text-sm transition-colors ${
                        checked ? 'border-sky-500 bg-sky-50' : 'border-gray-200 bg-white hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRecipient(p.userId)}
                          className="h-4 w-4 rounded text-sky-600 focus:ring-sky-500"
                        />
                        <span className="font-medium text-gray-900 truncate">
                          {p.name}{isYou && <span className="ml-1 text-gray-400 text-xs">(you)</span>}
                        </span>
                      </div>
                      <span className="ml-2 text-xs text-gray-500 shrink-0">{voteState}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {step === 'confirm' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-700">Confirm the details before we send it out.</p>
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm">
                <div className="font-semibold text-gray-900">{eventTitle}</div>
                <div className="mt-1 text-gray-700">📅 {selectedDateLabel}</div>
                {finalVenue && <div className="mt-0.5 text-gray-700">📍 {finalVenue}</div>}
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Notifying ({selectedRecipients.size})</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {allParticipants
                    .filter((p) => selectedRecipients.has(p.userId))
                    .map((p) => (
                      <span key={p.userId} className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-800">
                        {p.name}{p.userId === currentUserId ? ' (you)' : ''}
                      </span>
                    ))}
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Recipients will get an in-app notification, push (if installed), and an email.
                A calendar event will be created and auto-added to their calendars.
              </p>
              {error && <p className="text-sm text-rose-600">{error}</p>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-5 py-3">
          <button
            type="button"
            onClick={() => {
              if (step === 'date') onClose();
              else if (step === 'recipients') setStep('date');
              else setStep('recipients');
            }}
            disabled={submitting}
            className="min-h-[44px] rounded-xl px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            {step === 'date' ? 'Cancel' : 'Back'}
          </button>
          {step === 'date' && (
            <button
              type="button"
              onClick={() => setStep('recipients')}
              disabled={!dateStepValid}
              className="min-h-[44px] rounded-xl bg-gradient-to-r from-cyan-500 to-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
            >
              Next
            </button>
          )}
          {step === 'recipients' && (
            <button
              type="button"
              onClick={() => setStep('confirm')}
              disabled={!recipientStepValid}
              className="min-h-[44px] rounded-xl bg-gradient-to-r from-cyan-500 to-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
            >
              Next
            </button>
          )}
          {step === 'confirm' && (
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="min-h-[44px] rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
            >
              {submitting ? 'Confirming…' : 'Confirm date'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
