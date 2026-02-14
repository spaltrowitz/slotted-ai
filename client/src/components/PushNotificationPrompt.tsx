import { useState } from 'react';
import { usePushNotifications } from '../hooks/usePushNotifications';

export default function PushNotificationPrompt() {
  const { permission, fcmToken, loading, error, requestPermission, isSupported } = usePushNotifications();
  const [verifyResult, setVerifyResult] = useState<'success' | 'fail' | null>(null);

  if (!isSupported) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-50/50 p-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔕</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-700">Notifications not supported</p>
            <p className="text-xs text-gray-500">
              Your browser doesn't support push notifications. For the best experience, install Slotted as an app on your phone (see instructions above).
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true;

  // Truly working = permission granted AND we have an FCM token
  const isFullyEnabled = permission === 'granted' && !!fcmToken;

  // Permission granted but no token — partial/broken state
  const isPartial = permission === 'granted' && !fcmToken;

  const handleRetry = async () => {
    setVerifyResult(null);
    const result = await requestPermission();
    setVerifyResult(result ? 'success' : 'fail');
  };

  if (isFullyEnabled) {
    return (
      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔔</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-emerald-900">Push notifications active</p>
            <p className="text-xs text-emerald-600">
              You'll get notified when friends want to hang, accept your invites, or when Slotted finds a great time to meet up.
            </p>
            {!isStandalone && (
              <p className="mt-1.5 text-[10px] text-emerald-500/80">
                💡 For the most reliable notifications, install Slotted as an app on your phone.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (isPartial) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl">⚠️</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900">Notifications partially set up</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Browser permission is granted, but we couldn't register your device for push notifications. This can happen if the service worker isn't active or you're not using the installed app.
            </p>
            {!isStandalone && (
              <p className="mt-1.5 text-[10px] text-amber-600">
                📲 Installing Slotted as an app (see above) gives the most reliable push notifications.
              </p>
            )}
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            {verifyResult === 'success' && (
              <p className="mt-2 text-xs text-emerald-600 font-medium">✅ Notifications are now working!</p>
            )}
            {verifyResult === 'fail' && (
              <p className="mt-2 text-xs text-red-600">Could not register. Try installing the app first.</p>
            )}
            <button
              onClick={handleRetry}
              disabled={loading}
              className="mt-3 rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Retrying…' : 'Retry Setup'}
            </button>
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
            <p className="text-xs text-gray-500">
              To enable notifications, update your browser or device notification settings to allow notifications for this site, then refresh the page.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Default: not yet asked
  return (
    <div className="rounded-2xl border border-slotted-200 bg-gradient-to-r from-slotted-50 to-purple-50 p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <span className="text-3xl">🔔</span>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-gray-900">Enable push notifications</h3>
          <p className="mt-1 text-xs text-gray-600 leading-relaxed">
            Get instant alerts when friends want to hang out, new matches are found, or someone accepts your invite.
          </p>
          {!isStandalone && (
            <p className="mt-1.5 text-[10px] text-gray-400">
              📲 For the best experience, install Slotted as an app first (see above), then enable notifications.
            </p>
          )}
          {error && (
            <p className="mt-2 text-xs text-red-600">{error}</p>
          )}
          <button
            onClick={requestPermission}
            disabled={loading}
            className="mt-3 rounded-xl bg-gradient-to-r from-slotted-500 to-purple-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Setting up…' : 'Enable Notifications'}
          </button>
        </div>
      </div>
    </div>
  );
}
