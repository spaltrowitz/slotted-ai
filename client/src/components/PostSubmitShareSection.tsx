import { useState } from 'react';
import InviteFriendModal from './InviteFriendModal';
import type { ScheduleEvent } from './EventSearchModal';

interface PostSubmitShareSectionProps {
  event: ScheduleEvent;
  pendingFriends: string[];
  eventScheduleId?: string;
}

export default function PostSubmitShareSection({
  event,
  pendingFriends,
  eventScheduleId,
}: PostSubmitShareSectionProps) {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <div className="rounded-2xl bg-gradient-to-br from-violet-50 to-fuchsia-50 border border-violet-200 p-5 space-y-4">
        {/* Confirmation */}
        <div className="text-center space-y-1">
          <p className="text-sm font-semibold text-violet-900">
            ✅ Your dates are in!
          </p>
          <p className="text-sm text-violet-700">
            Now invite friends to pick theirs
          </p>
        </div>

        {/* Share CTA */}
        <div className="rounded-xl bg-white/80 border border-violet-100 p-4 space-y-3">
          <p className="text-center text-sm font-medium text-gray-800">
            Pick a time for {event.title} with me! 🎭
          </p>

          <button
            onClick={() => setShowModal(true)}
            className="w-full rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-3 text-sm font-semibold text-white shadow-md transition-all hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 flex items-center justify-center gap-2"
          >
            🔗 Share invite link
          </button>
        </div>

        {/* Waiting status */}
        {pendingFriends.length > 0 && (
          <p className="text-center text-xs text-violet-600">
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
