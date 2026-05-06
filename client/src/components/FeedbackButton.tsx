import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import api from '../lib/api';

export default function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(false);

  const feedbackMutation = useMutation({
    mutationFn: async (message: string) => {
      await api.post('/feedback', { message });
    },
  });

  const handleSend = async () => {
    if (!text.trim()) return;
    setError(false);
    try {
      await feedbackMutation.mutateAsync(text.trim());
      setSent(true);
      setText('');
      setTimeout(() => {
        setSent(false);
        setOpen(false);
      }, 1500);
    } catch {
      setError(true);
    }
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-slotted-500 to-purple-600 text-lg text-white shadow-lg transition-all hover:shadow-xl hover:scale-105 md:bottom-6"
        aria-label="Send feedback"
      >
        💬
      </button>

      {/* Modal overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 pb-4" onClick={() => !feedbackMutation.isPending && setOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            {sent ? (
              <div className="flex flex-col items-center py-6">
                <span className="text-2xl">✓</span>
                <p className="mt-2 text-sm font-semibold text-emerald-600">Sent! Thank you</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-900">Feedback</h3>
                  <button
                    onClick={() => setOpen(false)}
                    className="rounded-lg p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                    aria-label="Close"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 mb-2">Bug or idea? Goes straight to the developer.</p>
                <textarea
                  value={text}
                  onChange={(e) => { setText(e.target.value); setError(false); }}
                  placeholder="What's on your mind?"
                  rows={3}
                  autoFocus
                  className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-all focus:border-slotted-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slotted-100"
                />
                {error && (
                  <p className="mt-1 text-[11px] text-red-600 font-medium">Couldn't send — try again</p>
                )}
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={handleSend}
                    disabled={!text.trim() || feedbackMutation.isPending}
                    className="rounded-xl gradient-btn px-5 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-sm"
                  >
                    {feedbackMutation.isPending ? 'Sending…' : 'Send Feedback'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
