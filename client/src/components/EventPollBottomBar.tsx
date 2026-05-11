import { useState } from 'react';
import InviteFriendModal from './InviteFriendModal';
import type { ScheduleEvent } from './EventSearchModal';

interface EventPollBottomBarProps {
  selectedCount: number;
  submitted: boolean;
  submitting?: boolean;
  pendingFriends: string[];
  event: ScheduleEvent;
  eventScheduleId?: string;
  onSubmit: () => void;
}

export default function EventPollBottomBar({
  selectedCount,
  submitted,
  submitting = false,
  pendingFriends,
  event,
  onSubmit,
  eventScheduleId,
}: EventPollBottomBarProps) {
  const [showModal, setShowModal] = useState(false);

  if (submitted) {
    return (
      <>
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-violet-200 bg-violet-50/95 backdrop-blur-sm px-4 py-3 safe-bottom">
          <div className="mx-auto max-w-lg flex items-center justify-between gap-3">
            <span className="text-xs text-violet-600">
              ⏳ Waiting for {pendingFriends.length > 2
                ? `${pendingFriends[0]}, ${pendingFriends[1]} +${pendingFriends.length - 2}`
                : pendingFriends.join(', ')}…
            </span>
            <button
              onClick={() => setShowModal(true)}
              className="rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 active:translate-y-0"
            >
              🔗 Invite friends
            </button>
          </div>
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

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 bg-white/95 backdrop-blur-sm px-4 py-3 safe-bottom">
      <div className="mx-auto max-w-lg flex items-center justify-between gap-3">
        <span className="text-sm text-gray-600">
          {selectedCount === 0
            ? 'Select dates that work'
            : `${selectedCount} date${selectedCount !== 1 ? 's' : ''} work${selectedCount === 1 ? 's' : ''} for me`}
        </span>
        <button
          onClick={onSubmit}
          disabled={selectedCount === 0 || submitting}
          className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all ${
            selectedCount > 0 && !submitting
              ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0'
              : 'bg-gray-300 cursor-not-allowed'
          }`}
        >
          {submitting ? 'Creating link…' : 'Send to friends'}
        </button>
      </div>
    </div>
  );
}
