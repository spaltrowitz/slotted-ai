import { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'slotted_install_dismissed';
const DISMISSED_EXPIRY_DAYS = 7;

function isDismissed(): boolean {
  const raw = localStorage.getItem(DISMISSED_KEY);
  if (!raw) return false;
  const ts = parseInt(raw, 10);
  if (Date.now() - ts > DISMISSED_EXPIRY_DAYS * 24 * 60 * 60 * 1000) {
    localStorage.removeItem(DISMISSED_KEY);
    return false;
  }
  return true;
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  );
}

function getDeviceInfo() {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const isMobile = isIOS || isAndroid || /Mobi/.test(ua);
  return { isIOS, isAndroid, isMobile };
}

export default function InstallPrompt({ alwaysShow = false }: { alwaysShow?: boolean }) {
  const [visible, setVisible] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const { isIOS, isAndroid, isMobile } = getDeviceInfo();

  // Listen for the native install prompt (Chrome/Android)
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Decide whether to show the banner
  useEffect(() => {
    if (isStandalone()) {
      // If alwaysShow, still set visible so we can show "already installed" state
      if (alwaysShow) setVisible(true);
      return;
    }
    if (alwaysShow) {
      setVisible(true);
      return;
    }
    if (isDismissed()) return;
    if (!isMobile) return;
    // Small delay so it doesn't flash on load
    const t = setTimeout(() => setVisible(true), 1500);
    return () => clearTimeout(t);
  }, [isMobile, alwaysShow]);

  const standalone = isStandalone();

  const handleInstall = async () => {
    if (deferredPrompt) {
      // Native install flow (Chrome on Android)
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setVisible(false);
      }
      setDeferredPrompt(null);
    } else {
      // Show manual instructions (iOS / other browsers)
      setShowInstructions(true);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, Date.now().toString());
    setVisible(false);
    setShowInstructions(false);
  };

  if (!visible) return null;

  // Already installed as PWA
  if (standalone) {
    return (
      <div className="mb-4 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📱</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-emerald-900">App installed</p>
            <p className="text-xs text-emerald-600">You're using Slotted as an installed app — great!</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Install banner */}
      {!showInstructions && (
        <div className="mb-4 rounded-2xl border border-slotted-200 bg-gradient-to-r from-slotted-50 to-purple-50 p-4 shadow-sm animate-in fade-in slide-in-from-top-2">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slotted-500 to-purple-600 text-lg text-white shadow-sm">
              📲
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">
                Add Slotted to your home screen
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                Get the full app experience — quick access, notifications, and more.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={handleInstall}
                  className="rounded-xl gradient-btn px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
                >
                  {deferredPrompt ? 'Install App' : 'Show Me How'}
                </button>
                <button
                  onClick={handleDismiss}
                  className="rounded-lg px-3 py-2 text-xs font-medium text-gray-400 transition-colors hover:text-gray-600"
                >
                  Maybe later
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step-by-step instructions modal */}
      {showInstructions && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-2xl bg-white p-6 pb-10 shadow-2xl animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-lg font-bold text-gray-900">
                Install Slotted
              </h2>
              <button
                onClick={handleDismiss}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            {isIOS ? (
              /* ---------- iOS Instructions ---------- */
              <div className="space-y-4">
                <p className="text-sm text-gray-500">
                  Follow these steps in <strong>Safari</strong> to add Slotted to your home screen:
                </p>

                <div className="space-y-3">
                  <Step
                    number={1}
                    emoji="🔗"
                    title="Tap the Share button"
                    description={
                      <>
                        Tap the{' '}
                        <span className="inline-flex items-center gap-0.5 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium">
                          <ShareIcon /> Share
                        </span>{' '}
                        button at the bottom of Safari.
                      </>
                    }
                  />

                  <Step
                    number={2}
                    emoji="➕"
                    title='Tap "Add to Home Screen"'
                    description="Scroll down in the share sheet and tap Add to Home Screen."
                  />

                  <Step
                    number={3}
                    emoji="✅"
                    title='Tap "Add"'
                    description='Confirm the name and tap Add in the top-right corner. Slotted will appear on your home screen!'
                  />
                </div>

                <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                  <p className="text-xs text-amber-700">
                    <strong>Note:</strong> This must be done in Safari. If you're in Chrome or another browser, copy the link and open it in Safari first.
                  </p>
                </div>
              </div>
            ) : isAndroid ? (
              /* ---------- Android Instructions ---------- */
              <div className="space-y-4">
                <p className="text-sm text-gray-500">
                  Follow these steps in <strong>Chrome</strong> to add Slotted to your home screen:
                </p>

                <div className="space-y-3">
                  <Step
                    number={1}
                    emoji="⋮"
                    title="Tap the menu (⋮)"
                    description="Tap the three-dot menu icon in the top-right corner of Chrome."
                  />

                  <Step
                    number={2}
                    emoji="📲"
                    title='Tap "Add to Home screen"'
                    description='Select "Add to Home screen" or "Install app" from the menu.'
                  />

                  <Step
                    number={3}
                    emoji="✅"
                    title='Tap "Add"'
                    description="Confirm the name and tap Add. Slotted will appear on your home screen!"
                  />
                </div>
              </div>
            ) : (
              /* ---------- Generic / Desktop fallback ---------- */
              <div className="space-y-4">
                <p className="text-sm text-gray-500">
                  You can install Slotted as an app or bookmark it for quick access:
                </p>

                <div className="space-y-3">
                  <Step
                    number={1}
                    emoji="📌"
                    title="Install as an app (Chrome / Edge)"
                    description={
                      <>
                        In Chrome, click the install icon{' '}
                        <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium">⊕</span>{' '}
                        in the address bar, or go to <strong>⋮ → Install Slotted</strong>. In Edge, go to <strong>… → Apps → Install this site as an app</strong>.
                      </>
                    }
                  />

                  <Step
                    number={2}
                    emoji="⭐"
                    title="Or bookmark it for quick access"
                    description={
                      <>
                        Press <strong>Ctrl+D</strong> (Windows) or <strong>⌘+D</strong> (Mac) to bookmark this page. You can also add it to your bookmarks bar for one-click access.
                      </>
                    }
                  />

                  <Step
                    number={3}
                    emoji="🔔"
                    title="Enable notifications"
                    description="After installing or bookmarking, make sure to enable push notifications below so you never miss a meetup request."
                  />
                </div>

                <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3">
                  <p className="text-xs text-blue-700">
                    <strong>Best on mobile:</strong> Slotted works on desktop, but the best experience is on your phone. Visit{' '}
                    <strong>slotted-ai.web.app</strong> on your phone's browser and install it from there.
                  </p>
                </div>
              </div>
            )}

            <button
              onClick={handleDismiss}
              className="mt-6 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-600 transition-all hover:bg-gray-50"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- Sub-components ---------- */

function Step({
  number,
  emoji,
  title,
  description,
}: {
  number: number;
  emoji: string;
  title: string;
  description: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slotted-100 text-xs font-bold text-slotted-700">
        {number}
      </div>
      <div>
        <p className="text-sm font-semibold text-gray-900">
          {emoji} {title}
        </p>
        <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function ShareIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15m0-3l-3-3m0 0l-3 3m3-3v12"
      />
    </svg>
  );
}
