import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';

const steps = [
  {
    number: '1',
    title: 'Connect your calendar',
    desc: 'Link your Google or Apple calendar in Settings. Slotted only reads busy/free times — never event titles or details. Your calendar stays private.',
  },
  {
    number: '2',
    title: 'Invite friends',
    desc: "Share your invite link via text, email, or copy link. They'll get a friend request when they sign up. Ask your friends to connect their calendar too — Slotted works best when both sides are synced.",
  },
  {
    number: '3',
    title: 'Find times',
    desc: 'Tap a friend to find times. Choose In Person, Phone Call, or Video Call. Slotted finds the best slots for each type — calls can be shorter and skip travel time.',
  },
  {
    number: '4',
    title: 'Book it',
    desc: "Pick a time and hit Book it. Your friend gets a notification to accept. Once confirmed, you'll both be prompted to save the event to your calendar.",
  },
];

export default function HelpPage() {
  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-gray-900">How Slotted works</h1>
        <p className="mt-1 text-sm text-gray-500">
          A quick guide to scheduling hangouts with friends.
        </p>
      </div>

      <div className="space-y-4">
        {steps.map((s) => (
          <div key={s.number} className="flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slotted-500 to-indigo-600 text-xs font-bold text-white">
              {s.number}
            </span>
            <div>
              <p className="text-sm font-semibold text-gray-900">{s.title}</p>
              <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">{s.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8">
        <Link
          to="/settings"
          className="text-sm font-medium text-slotted-600 hover:text-slotted-700 transition-colors"
        >
          ← Back to Settings
        </Link>
      </div>
    </AppShell>
  );
}
