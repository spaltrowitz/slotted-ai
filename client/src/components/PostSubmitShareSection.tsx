import { useState } from 'react';
import InviteFriendModal from './InviteFriendModal';
import type { ScheduleEvent } from './EventSearchModal';

interface PostSubmitShareSectionProps {
  event: ScheduleEvent;
  pendingFriends: string[];
  eventScheduleId?: string;
  inviteUrl?: string;
}

export default function PostSubmitShareSection({
  event,
  pendingFriends,
  eventScheduleId,
  inviteUrl,
}: PostSubmitShareSectionProps) {
  const [showModal, setShowModal] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareMessage = `Pick your dates for ${event.title}${event.venue ? ` at ${event.venue}` : ''} with me`;

  const copyInviteUrl = async () => {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const textInviteUrl = () => {
    if (!inviteUrl) return;
    window.open(`sms:?&body=${encodeURIComponent(`${shareMessage}\n\n${inviteUrl}`)}`, '_self');
  };

  return (
    <>
      <div className="rounded-2xl bg-gradient-to-br from-cyan-50 to-sky-50 border border-sky-200 p-5 space-y-4">
        {/* Confirmation */}
        <div className="text-center space-y-1">
          <p className="text-sm font-semibold text-sky-900">
            ✅ Your dates are in!
          </p>
          <p className="text-sm text-sky-700">
            Now invite friends to pick theirs
          </p>
        </div>

        {/* Share CTA */}
        <div className="rounded-xl bg-white/80 border border-sky-100 p-4 space-y-3">
          <p className="text-center text-sm font-medium text-gray-800">
            Pick a time for {event.title} with me! 🎭
          </p>

          {inviteUrl ? (
            <>
              <div className="rounded-xl border border-sky-100 bg-white px-3 py-2">
                <p className="truncate font-mono text-xs text-gray-600">{inviteUrl}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={copyInviteUrl}
                  className="min-h-[44px] rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50"
                >
                  {copied ? 'Copied!' : 'Copy link'}
                </button>
                <button
                  onClick={textInviteUrl}
                  className="min-h-[44px] rounded-xl bg-gradient-to-r from-cyan-500 to-sky-500 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md"
                >
                  Text link
                </button>
              </div>
              <p className="text-center text-[11px] text-gray-500">
                Once texting is connected, Slotted can send this poll link automatically.
              </p>
            </>
          ) : (
            <button
              onClick={() => setShowModal(true)}
              className="w-full rounded-xl bg-gradient-to-r from-cyan-500 to-sky-500 px-4 py-3 text-sm font-semibold text-white shadow-md transition-all hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 flex items-center justify-center gap-2"
            >
              🔗 Share invite link
            </button>
          )}
        </div>

        {/* Waiting status */}
        {pendingFriends.length > 0 && (
          <p className="text-center text-xs text-sky-600">
            ⏳ Waiting for {pendingFriends.join(', ')}…
          </p>
        )}
      </div>

      {showModal && (
        <InviteFriendModal
          event={event}
          eventScheduleId={eventScheduleId}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}
