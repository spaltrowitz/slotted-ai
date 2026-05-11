import { useState } from 'react';
import EventSearchModal from './EventSearchModal';
import type { FriendRecord } from '../lib/queries';

interface EventScheduleButtonProps {
  friends?: FriendRecord[];
  preselectedFriendIds?: string[];
  variant?: 'primary' | 'compact';
  initialMode?: 'search' | 'browse';
  label?: string;
}

export default function EventScheduleButton({
  friends = [],
  preselectedFriendIds = [],
  variant = 'primary',
  initialMode = 'search',
  label,
}: EventScheduleButtonProps) {
  const [showModal, setShowModal] = useState(false);

  if (variant === 'compact') {
    return (
      <>
        <button
          onClick={() => setShowModal(true)}
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-sky-200 bg-gradient-to-r from-cyan-50 to-sky-50 px-4 py-2.5 text-center text-sm font-semibold text-sky-700 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 hover:border-sky-300"
        >
          <span>{label ?? 'Find an event instead'}</span>
        </button>
        {showModal && (
          <EventSearchModal
            friends={friends}
            preselectedFriendIds={preselectedFriendIds}
            initialMode={initialMode}
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
        className="w-full rounded-xl bg-gradient-to-r from-cyan-500 to-sky-500 px-5 py-3 text-center text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
      >
        {label ?? (initialMode === 'browse' ? '🎟️ Browse event ideas' : '🎟️ Search by event name')}
      </button>
      {showModal && (
        <EventSearchModal
          friends={friends}
          preselectedFriendIds={preselectedFriendIds}
          initialMode={initialMode}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}
