import { useState } from 'react';
import EventSearchModal from './EventSearchModal';
import type { FriendRecord } from '../lib/queries';

interface EventScheduleButtonProps {
  friends?: FriendRecord[];
  preselectedFriendIds?: string[];
  variant?: 'primary' | 'compact';
}

export default function EventScheduleButton({
  friends = [],
  preselectedFriendIds = [],
  variant = 'primary',
}: EventScheduleButtonProps) {
  const [showModal, setShowModal] = useState(false);

  if (variant === 'compact') {
    return (
      <>
        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-gradient-to-r from-violet-50 to-fuchsia-50 px-4 py-2.5 text-sm font-semibold text-violet-700 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 hover:border-violet-300"
        >
          <span>🎭</span>
          <span>Plan an Event</span>
        </button>
        {showModal && (
          <EventSearchModal
            friends={friends}
            preselectedFriendIds={preselectedFriendIds}
            onClose={() => setShowModal(false)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="w-full rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-3 text-center text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
      >
        🎭 Plan an Event
      </button>
      {showModal && (
        <EventSearchModal
          friends={friends}
          preselectedFriendIds={preselectedFriendIds}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}
