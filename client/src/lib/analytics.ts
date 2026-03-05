import { app } from './firebase';
import type { Analytics } from 'firebase/analytics';

let analyticsInstance: Analytics | null = null;

async function getAnalyticsInstance() {
  if (analyticsInstance) return analyticsInstance;
  
  const { getAnalytics, isSupported } = await import('firebase/analytics');
  const supported = await isSupported();
  if (!supported) return null;
  
  analyticsInstance = getAnalytics(app);
  return analyticsInstance;
}

/**
 * Track a funnel event. All events are prefixed with "slotted_" for easy filtering.
 */
export async function trackEvent(eventName: string, params?: Record<string, string | number | boolean>) {
  try {
    const analytics = await getAnalyticsInstance();
    if (!analytics) return;
    
    const { logEvent } = await import('firebase/analytics');
    logEvent(analytics, eventName, params);
  } catch {
    // silently fail — analytics should never break the app
  }
}

// ─── Funnel Events ───

/** User lands on the login/home page */
export const trackPageView = (page: string) =>
  trackEvent('page_view', { page_title: page });

/** User creates an account (first sign-in) */
export const trackSignUp = () =>
  trackEvent('slotted_sign_up');

/** User signs in (returning) */
export const trackSignIn = () =>
  trackEvent('slotted_sign_in');

/** User connects Google Calendar */
export const trackCalendarConnected = (provider: 'google' | 'apple') =>
  trackEvent('slotted_calendar_connected', { provider });

/** User completes onboarding */
export const trackOnboardingComplete = () =>
  trackEvent('slotted_onboarding_complete');

/** User skips onboarding */
export const trackOnboardingSkipped = () =>
  trackEvent('slotted_onboarding_skipped');

/** User saves settings */
export const trackSettingsSaved = () =>
  trackEvent('slotted_settings_saved');

/** User adds app to home screen */
export const trackAppInstalled = () =>
  trackEvent('slotted_app_installed');

/** User copies invite link */
export const trackInviteLinkCopied = () =>
  trackEvent('slotted_invite_link_copied');

/** User sends a friend request or invite email */
export const trackFriendInvited = (method: 'link' | 'email' | 'sms') =>
  trackEvent('slotted_friend_invited', { method });

/** A friend request is accepted */
export const trackFriendAdded = () =>
  trackEvent('slotted_friend_added');

/** User views availability overlap with a friend */
export const trackAvailabilityViewed = () =>
  trackEvent('slotted_availability_viewed');

/** User proposes/confirms a meetup */
export const trackMeetupScheduled = () =>
  trackEvent('slotted_meetup_scheduled');

/** User opens the app from home screen (standalone mode) */
export const trackStandaloneOpen = () => {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as any).standalone === true;
  if (isStandalone) {
    trackEvent('slotted_standalone_open');
  }
};
