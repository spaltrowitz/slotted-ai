import { usePushNotifications } from '../hooks/usePushNotifications';

export default function PushNotificationPrompt() {
  const { permission, loading, error, requestPermission, isSupported } = usePushNotifications();

  if (!isSupported) {
    return null; // Don't show anything if browser doesn't support notifications
  }

  if (permission === 'granted') {
    return (
      <div className="rounded-2xl border border-amber-100 bg-amber-50/50 p-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔔</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-900">Push notifications enabled</p>
            <p className="text-xs text-amber-600">⚠️ Note: Notifications require additional Firebase configuration to work. Currently in setup.</p>
          </div>
        </div>
      </div>
    );
  }

  if (permission === 'denied') {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-50/50 p-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔕</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-700">Notifications blocked</p>
            <p className="text-xs text-gray-500">To enable notifications, allow them in your browser settings</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slotted-200 bg-gradient-to-r from-slotted-50 to-purple-50 p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <span className="text-3xl">🔔</span>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-gray-900">Enable push notifications</h3>
          <p className="mt-1 text-xs text-gray-600 leading-relaxed">
            Get instant alerts when friends want to hang out, new matches are found, or someone accepts your invite
          </p>
          {error && (
            <p className="mt-2 text-xs text-red-600">{error}</p>
          )}
          <button
            onClick={requestPermission}
            disabled={loading}
            className="mt-3 rounded-xl bg-gradient-to-r from-slotted-500 to-purple-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Requesting...' : 'Enable Notifications'}
          </button>
        </div>
      </div>
    </div>
  );
}
