import { useState } from 'react';

interface StarRatingProps {
  onSubmit: (rating: number) => void;
  onSkip: () => void;
  friendName: string;
  submitting?: boolean;
}

export default function StarRating({ onSubmit, onSkip, friendName, submitting = false }: StarRatingProps) {
  const [rating, setRating] = useState(0);
  const [hovering, setHovering] = useState(0);

  return (
    <div className="flex flex-col items-center text-center py-4">
      <p className="text-lg font-semibold text-gray-900">
        How was hanging with {friendName}?
      </p>

      <div className="mt-5 flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((star) => {
          const filled = star <= (hovering || rating);
          return (
            <button
              key={star}
              onClick={() => setRating(star)}
              onMouseEnter={() => setHovering(star)}
              onMouseLeave={() => setHovering(0)}
              className="flex items-center justify-center min-h-[44px] min-w-[44px] transition-transform hover:scale-110"
            >
              <svg
                className={`h-8 w-8 transition-colors ${filled ? 'text-amber-400' : 'text-gray-200'}`}
                viewBox="0 0 24 24"
                fill={filled ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
                />
              </svg>
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={() => rating > 0 && onSubmit(rating)}
          disabled={rating === 0 || submitting}
          className="rounded-xl gradient-btn px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 disabled:opacity-40"
        >
          {submitting ? 'Saving…' : 'Submit'}
        </button>
        <button
          onClick={onSkip}
          className="rounded-xl border border-gray-200 bg-white px-6 py-2.5 text-sm font-medium text-gray-500 shadow-sm transition-all hover:bg-gray-50"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
