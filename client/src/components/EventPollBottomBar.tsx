interface EventPollBottomBarProps {
  selectedCount: number;
  submitted: boolean;
  pendingFriends: string[];
  onSubmit: () => void;
}

export default function EventPollBottomBar({
  selectedCount,
  submitted,
  pendingFriends,
  onSubmit,
}: EventPollBottomBarProps) {
  if (submitted) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-violet-200 bg-violet-50/95 backdrop-blur-sm px-4 py-3 safe-bottom">
        <div className="mx-auto max-w-lg flex items-center justify-center gap-2">
          <span className="text-sm font-medium text-violet-700">
            ⏳ Waiting for {pendingFriends.length > 2
              ? `${pendingFriends[0]}, ${pendingFriends[1]} +${pendingFriends.length - 2}`
              : pendingFriends.join(', ')}…
          </span>
        </div>
      </div>
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
          disabled={selectedCount === 0}
          className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all ${
            selectedCount > 0
              ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0'
              : 'bg-gray-300 cursor-not-allowed'
          }`}
        >
          Send to friends
        </button>
      </div>
    </div>
  );
}
