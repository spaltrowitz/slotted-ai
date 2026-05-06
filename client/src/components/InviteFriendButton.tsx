import { useState } from 'react';
import InviteFriendModal from './InviteFriendModal';
import type { ScheduleEvent } from './EventSearchModal';

interface InviteFriendButtonProps {
  event: ScheduleEvent;
  eventScheduleId?: string;
}

export default function InviteFriendButton({ event, eventScheduleId }: InviteFriendButtonProps) {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:shadow-md"
      >
        🔗 Invite a friend
      </button>

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
