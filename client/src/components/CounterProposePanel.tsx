import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';

interface ScoredSlot {
  start: string;
  end: string;
  score: number;
  reasons: string[];
  dayLabel: string;
  timeLabel: string;
}

interface CounterProposePanelProps {
  meetupId: string;
  friendId: string;
  friendName: string;
  originalTime: string;
  onCounterProposed: () => void;
  onJustDecline: () => void;
  onCancel: () => void;
}

export default function CounterProposePanel({
  meetupId,
  friendId,
  friendName,
  originalTime: _originalTime,
  onCounterProposed,
  onJustDecline,
  onCancel,
}: CounterProposePanelProps) {
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<ScoredSlot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [proposing, setProposing] = useState<string | null>(null);
  const [proposed, setProposed] = useState(false);

  const fetchSlots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/availability/overlap/${friendId}?mode=in_person`);
      setSuggestions(data.suggestions || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to find alternative times');
    } finally {
      setLoading(false);
    }
  }, [friendId]);

  useEffect(() => {
    fetchSlots();
  }, [fetchSlots]);

  const handleCounterPropose = async (slot: ScoredSlot) => {
    setProposing(slot.start);
    try {
      await api.post(`/meetups/${meetupId}/counter-propose`, {
        startTime: slot.start,
        endTime: slot.end,
      });
      setProposed(true);
      setTimeout(() => onCounterProposed(), 1500);
    } catch {
      setError('Failed to send counter-proposal');
    } finally {
      setProposing(null);
    }
  };

  const scoreColor = (score: number) => {
    if (score >= 75) return 'text-emerald-600 bg-emerald-50 border-emerald-200';
    if (score >= 50) return 'text-amber-600 bg-amber-50 border-amber-200';
    return 'text-gray-500 bg-gray-50 border-gray-200';
  };

  if (proposed) {
    return (
      <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
        <span className="text-lg">🔄</span>
        <p className="mt-1 text-sm font-semibold text-emerald-700">Counter-proposal sent!</p>
        <p className="mt-0.5 text-xs text-emerald-600">{friendName} will get a notification with your suggested time.</p>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 bg-gradient-to-r from-amber-50/50 to-orange-50/50">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">🔄 Suggest a different time?</p>
          <p className="mt-0.5 text-[11px] text-gray-500">
            Pick a time that works better for you
          </p>
        </div>
        <button
          onClick={onCancel}
          className="rounded-lg border border-gray-200 p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition-all"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="px-4 py-3">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-6">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-slotted-400 border-t-transparent" />
            <p className="mt-2 text-xs text-gray-400">Finding alternative times…</p>
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-100 bg-red-50/50 px-3 py-2 text-xs text-red-600">
            {error}
          </div>
        ) : suggestions.length === 0 ? (
          <div className="text-center py-4">
            <span className="text-2xl">📅</span>
            <p className="mt-2 text-xs text-gray-500">No overlapping free times found in the next 2 weeks.</p>
          </div>
        ) : (
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {suggestions.slice(0, 5).map((slot) => (
              <div
                key={slot.start}
                className="flex items-center gap-2.5 rounded-lg border border-gray-200 px-3 py-2.5 hover:border-gray-300 hover:bg-gray-50/50 transition-all"
              >
                {/* Score */}
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold ${scoreColor(slot.score)}`}>
                  {slot.score}
                </div>

                {/* Time info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{slot.dayLabel}</p>
                  <p className="text-[11px] text-gray-500">{slot.timeLabel}</p>
                </div>

                {/* Suggest button */}
                <button
                  onClick={() => handleCounterPropose(slot)}
                  disabled={proposing === slot.start}
                  className="shrink-0 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 disabled:opacity-50"
                >
                  {proposing === slot.start ? '…' : 'Suggest'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer — just decline option */}
      <div className="border-t border-gray-100 px-4 py-2.5 flex items-center justify-between bg-gray-50/50">
        <p className="text-[11px] text-gray-400">
          Or skip suggesting a time
        </p>
        <button
          onClick={onJustDecline}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-all"
        >
          Just decline
        </button>
      </div>
    </div>
  );
}
