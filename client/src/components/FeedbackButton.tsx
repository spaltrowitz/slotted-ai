import { useState, useEffect, useRef, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import api from '../lib/api';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

type Category = 'bug' | 'idea' | 'love';

const categories: { key: Category; emoji: string; label: string }[] = [
  { key: 'bug', emoji: '🐛', label: 'Bug' },
  { key: 'idea', emoji: '💡', label: 'Idea' },
  { key: 'love', emoji: '💜', label: 'Love it' },
];

const placeholders: Record<Category, string> = {
  bug: 'e.g., The scheduling screen freezes when I select 3+ friends',
  idea: 'e.g., It would be cool if I could share my availability link',
  love: 'e.g., The group scheduling feature is amazing!',
};

const helperText: Record<Category, string> = {
  bug: 'Describe what went wrong and the steps to reproduce it.',
  idea: "Tell us what you'd like to see — no idea is too small.",
  love: "We love hearing what's working! Share the joy.",
};

export default function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category | null>(null);
  const [summary, setSummary] = useState('');
  const [details, setDetails] = useState('');
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  useBodyScrollLock(open);

  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const feedbackMutation = useMutation({
    mutationFn: async (payload: { category: Category; summary: string; details: string }) => {
      await api.post('/feedback', payload);
    },
  });

  const resetForm = useCallback(() => {
    setCategory(null);
    setSummary('');
    setDetails('');
    setStatus('idle');
  }, []);

  const closeModal = useCallback(() => {
    if (feedbackMutation.isPending) return;
    setOpen(false);
    resetForm();
    previousFocusRef.current?.focus();
  }, [feedbackMutation.isPending, resetForm]);

  // Focus trap + escape to close
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeModal();
        return;
      }
      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    // Focus first interactive element
    setTimeout(() => {
      modalRef.current?.querySelector<HTMLElement>('button, input, textarea')?.focus();
    }, 50);

    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, closeModal]);

  const handleSubmit = async () => {
    if (!category || !summary.trim()) return;
    setStatus('idle');
    try {
      await feedbackMutation.mutateAsync({
        category,
        summary: summary.trim(),
        details: details.trim(),
      });
      setStatus('success');
      setTimeout(() => {
        closeModal();
      }, 2000);
    } catch {
      setStatus('error');
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-slotted-500 to-purple-600 text-lg text-white shadow-lg transition-all hover:shadow-xl hover:scale-105 md:bottom-6"
        aria-label="Send feedback"
      >
        💬
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-0 sm:px-4 pb-0 sm:pb-4"
          onClick={closeModal}
          role="presentation"
        >
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-title"
            className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white p-5 sm:p-6 shadow-xl max-h-[85dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {status === 'success' ? (
              <div className="flex flex-col items-center py-8">
                <span className="text-3xl">✅</span>
                <p className="mt-3 text-sm font-semibold text-emerald-600">Feedback sent! Thank you</p>
                <p className="mt-1 text-xs text-gray-400">We'll look into it shortly.</p>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <h3 id="feedback-title" className="text-base font-semibold text-gray-900">
                    Send Feedback
                  </h3>
                  <button
                    onClick={closeModal}
                    className="rounded-lg p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                    aria-label="Close feedback"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Category selector */}
                <div className="flex gap-2 mb-4">
                  {categories.map((cat) => (
                    <button
                      key={cat.key}
                      onClick={() => setCategory(cat.key)}
                      className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 min-h-[44px] text-sm font-medium transition-all ${
                        category === cat.key
                          ? 'bg-slotted-500 text-white shadow-md'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                      aria-pressed={category === cat.key}
                    >
                      <span>{cat.emoji}</span>
                      <span>{cat.label}</span>
                    </button>
                  ))}
                </div>

                {/* Form (visible after category selection) */}
                {category && (
                  <div className="space-y-3">
                    <p className="text-xs text-gray-500">{helperText[category]}</p>
                    <input
                      type="text"
                      value={summary}
                      onChange={(e) => setSummary(e.target.value)}
                      placeholder={placeholders[category]}
                      className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-all focus:border-slotted-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slotted-100"
                      aria-label="Summary"
                    />
                    <textarea
                      value={details}
                      onChange={(e) => setDetails(e.target.value)}
                      placeholder="Details (optional) — any extra context helps"
                      rows={3}
                      className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-all focus:border-slotted-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slotted-100"
                      aria-label="Details"
                    />

                    {status === 'error' && (
                      <p className="text-xs text-red-600 font-medium">
                        Couldn't send — please try again.
                      </p>
                    )}

                    <button
                      onClick={handleSubmit}
                      disabled={!summary.trim() || feedbackMutation.isPending}
                      className="w-full rounded-xl gradient-btn px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-sm"
                    >
                      {feedbackMutation.isPending ? 'Submitting…' : 'Submit Feedback'}
                    </button>

                    <p className="text-xs text-gray-400 text-center">
                      Creates a GitHub issue assigned to Copilot for automatic triage
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
