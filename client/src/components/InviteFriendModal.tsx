import { useState, useEffect, useRef } from 'react';
import api from '../lib/api';
import type { ScheduleEvent } from './EventSearchModal';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

interface InviteFriendModalProps {
  event: ScheduleEvent;
  eventScheduleId?: string;
  onClose: () => void;
}

export default function InviteFriendModal({ event, eventScheduleId, onClose }: InviteFriendModalProps) {
  const [friendName, setFriendName] = useState('');
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useBodyScrollLock(true);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const generateLink = async () => {
    if (!friendName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post('/events/friend-invite', {
        eventScheduleId,
        eventTitle: event.title,
      });
      setInviteUrl(data.inviteUrl);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to generate invite link.';
      setError(`${message} Try again.`);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = inviteUrl;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const shareMessage = `Hey ${friendName.trim()}! I'm picking a time for ${event.title} at ${event.venue} — join me and vote on a showtime! 🎭`;

  const handleShareText = () => {
    if (!inviteUrl) return;
    const body = `${shareMessage}\n\n${inviteUrl}`;
    window.open(`sms:?&body=${encodeURIComponent(body)}`, '_self');
  };

  const handleShareEmail = () => {
    if (!inviteUrl) return;
    const subject = `Pick a time for ${event.title}! 🎭`;
    const body = `${shareMessage}\n\n${inviteUrl}`;
    window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_self');
  };

  const handleNativeShare = async () => {
    if (!inviteUrl || !navigator.share) return;
    try {
      await navigator.share({
        title: `Join me for ${event.title}!`,
        text: shareMessage,
        url: inviteUrl,
      });
    } catch {
      // User cancelled share
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-0 sm:px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Invite a friend"
    >
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">🔗 Invite a friend</h2>
          <button
            onClick={onClose}
            className="text-sm font-medium text-gray-500 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          {!inviteUrl ? (
            <>
              {/* Event context */}
              <div className="flex items-center gap-3 rounded-xl bg-gray-50 p-3">
                {event.imageUrl && (
                  <img src={event.imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover" loading="lazy" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{event.title}</p>
                  <p className="text-xs text-gray-500">{event.venue}</p>
                </div>
              </div>

              {/* Friend name input */}
              <div>
                <label htmlFor="friend-name" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Who are you inviting?
                </label>
                <input
                  ref={inputRef}
                  id="friend-name"
                  type="text"
                  value={friendName}
                  onChange={(e) => setFriendName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') generateLink(); }}
                  placeholder="Their first name"
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:border-slotted-400 focus:ring-2 focus:ring-slotted-100 outline-none transition-all"
                />
              </div>

              {error && (
                <p className="text-xs text-red-500">{error}</p>
              )}

              <button
                onClick={generateLink}
                disabled={!friendName.trim() || loading}
                className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-blue-500 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Generating…' : 'Generate invite link'}
              </button>
            </>
          ) : (
            <>
              {/* Success state — share options */}
              <div className="text-center space-y-2">
                <span className="text-3xl">🎉</span>
                <p className="text-sm font-medium text-gray-900">
                  Invite link ready for {friendName.trim()}!
                </p>
              </div>

              {/* Link display */}
              <div className="flex items-center gap-2 rounded-xl bg-gray-50 border border-gray-100 p-3">
                <p className="flex-1 text-xs text-gray-600 truncate font-mono">{inviteUrl}</p>
                <button
                  onClick={handleCopy}
                  className="shrink-0 rounded-lg bg-white border border-gray-200 px-3 py-1.5 min-h-[44px] text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-all"
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>

              {/* Share buttons */}
              <div className="space-y-2">
                {typeof navigator.share === 'function' && (
                  <button
                    onClick={handleNativeShare}
                    className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all flex items-center justify-center gap-2"
                  >
                    📤 Share
                  </button>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleShareText}
                    className="flex-1 rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all"
                  >
                    💬 Text
                  </button>
                  <button
                    onClick={handleShareEmail}
                    className="flex-1 rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all"
                  >
                    ✉️ Email
                  </button>
                </div>
              </div>

              <p className="mt-3 text-xs text-gray-500 text-center">
                📱 SMS invites for friends without Slotted — coming soon
              </p>

              <button
                onClick={onClose}
                className="w-full rounded-xl bg-gray-100 px-4 py-3 min-h-[44px] text-sm font-medium text-gray-600 hover:bg-gray-200 transition-all"
              >
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
