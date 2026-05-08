import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../lib/api';

interface SmartSuggestion {
  friendId: string;
  friendName: string;
  activity: string;
  reason: string;
  timeHint: string;
  urgency: 'overdue' | 'normal' | 'new_friend';
  confidence: number;
}

interface SmartSuggestionsResponse {
  suggestions: SmartSuggestion[];
  hasEnoughData: boolean;
}

const ACTIVITY_EMOJI: Record<string, string> = {
  coffee: '☕', meal: '🍽️', drinks: '🍻', walk: '🚶', workout: '💪',
  movie: '🎬', game_night: '🎲', phone_call: '📞', facetime: '📱',
  video_call: '💻', other: '🤝',
};

const ACTIVITY_VERB: Record<string, string> = {
  coffee: 'Grab coffee', meal: 'Get a meal', drinks: 'Get drinks',
  walk: 'Go for a walk', workout: 'Work out', movie: 'See a movie',
  game_night: 'Do a game night', phone_call: 'Catch up on the phone',
  facetime: 'FaceTime', video_call: 'Hop on a call', other: 'Hang out',
};

export default function SmartSuggestions() {
  const { data, isLoading } = useQuery({
    queryKey: ['smartSuggestions'],
    queryFn: async () => {
      const { data } = await api.get<SmartSuggestionsResponse>('/suggestions/smart');
      return data;
    },
    staleTime: 10 * 60 * 1000,
  });

  if (isLoading || !data?.hasEnoughData || data.suggestions.length === 0) return null;

  return (
    <div className="rounded-2xl border border-gray-200/60 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-gray-400 mb-3">Based on your hangout history</p>
      <div className="space-y-3">
        {data.suggestions.map((s) => (
          <div key={s.friendId} className="flex items-start gap-3">
            <span className="text-lg shrink-0 mt-0.5">
              {ACTIVITY_EMOJI[s.activity] || '🤝'}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">
                {ACTIVITY_VERB[s.activity] || 'Hang out'} with {s.friendName}
              </p>
              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{s.reason}</p>
            </div>
            <Link
              to={`/dashboard?findTimes=${s.friendId}`}
              className="shrink-0 text-xs font-medium text-slotted-600 hover:text-slotted-700 transition-colors mt-0.5"
            >
              Find a time →
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
