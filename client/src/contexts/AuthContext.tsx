import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as firebaseSignOut,
  getAdditionalUserInfo,
  type User,
} from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';
import api from '../lib/api';
import { trackSignUp, trackSignIn, trackCalendarConnected, trackOnboardingComplete, trackOnboardingSkipped } from '../lib/analytics';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  authError: string | null;
  isNewUser: boolean;
  onboardingComplete: boolean;
  calendarConnected: boolean;
  googleCalendarConnected: boolean;
  googleCalendarStale: boolean;
  calendarJustConnected: boolean;
  appleCalendarConnected: boolean;
  outlookCalendarConnected: boolean;
  clearNewUser: () => void;
  completeOnboarding: () => void;
  skipOnboarding: () => void;
  connectCalendar: () => Promise<void>;
  disconnectCalendar: () => Promise<void>;
  connectAppleCalendar: (username: string, password: string) => Promise<{ success: boolean; error?: string; calendarsFound?: number }>;
  disconnectAppleCalendar: () => Promise<void>;
  connectOutlookCalendar: () => Promise<void>;
  disconnectOutlookCalendar: () => Promise<void>;
  verifyCalendarHealth: () => Promise<void>;
  isSigningIn: boolean;
  signInWithGoogle: () => Promise<User | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isNewUser, setIsNewUser] = useState(false);

  // Capture referral param from URL as early as possible (before any redirects)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) {
      localStorage.setItem('slotted_referrer', ref);
      localStorage.removeItem('slotted_referrer_email');
    } else if (!localStorage.getItem('slotted_referrer')) {
      localStorage.setItem('slotted_referrer_email', 'sharipaltrowitz@gmail.com');
    }
  }, []);

  const [onboardingComplete, setOnboardingComplete] = useState(() => {
    return localStorage.getItem('slotted_onboarding_complete') === 'true';
  });
  const [calendarConnected, setCalendarConnected] = useState(() => {
    return localStorage.getItem('slotted_calendar_connected') === 'true';
  });
  const [googleCalendarConnected, setGoogleCalendarConnected] = useState(() => {
    return localStorage.getItem('slotted_google_calendar_connected') === 'true';
  });
  const [calendarJustConnected, setCalendarJustConnected] = useState(false);
  const [appleCalendarConnected, setAppleCalendarConnected] = useState(() => {
    return localStorage.getItem('slotted_apple_calendar_connected') === 'true';
  });
  const [outlookCalendarConnected, setOutlookCalendarConnected] = useState(() => {
    return localStorage.getItem('slotted_outlook_calendar_connected') === 'true';
  });
  const [googleCalendarStale, setGoogleCalendarStale] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
      // Ensure user record exists in DB on every session
      if (firebaseUser) {
        await syncUserToDb(firebaseUser);
        // Auto-connect referral on every auth state change (handles already-logged-in users
        // who click a referral link and get redirected before signInWithGoogle runs)
        await connectReferral(firebaseUser);
        const postAuthRedirect = sessionStorage.getItem('slotted_post_auth_redirect');
        if (postAuthRedirect && window.location.pathname !== postAuthRedirect) {
          sessionStorage.removeItem('slotted_post_auth_redirect');
          window.location.replace(postAuthRedirect);
        }
      }
    });
    return unsubscribe;
  }, []);

  // Handle redirect result on page load (fallback for when popup is blocked)
  useEffect(() => {
    getRedirectResult(auth)
      .then(async (result) => {
        if (result) {
          const additionalInfo = getAdditionalUserInfo(result);
          if (additionalInfo?.isNewUser) {
            setIsNewUser(true);
          }
          // Auto-connect with referrer after redirect sign-in
          await syncUserToDb(result.user);
          await connectReferral(result.user);
        }
      })
      .catch((err) => {
        console.error('Redirect result error:', err);
      });
  }, []);

  // Sync Firebase user to Supabase DB (upsert on every sign-in)
  const syncUserToDb = async (firebaseUser: User) => {
    try {
      await api.post('/users/me', {
        email: firebaseUser.email,
        displayName: firebaseUser.displayName,
        photoUrl: firebaseUser.photoURL,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    } catch (err) {
      console.error('User sync failed:', err instanceof Error ? err.message : err);
    }
  };

  // After sign-in, auto-connect with referrer if a referral link was used
  const connectReferral = async (firebaseUser: User) => {
    const referrerUid = localStorage.getItem('slotted_referrer');
    const referrerEmail = localStorage.getItem('slotted_referrer_email');
    if (!referrerUid && !referrerEmail) return;
    if (referrerUid && referrerUid === firebaseUser.uid) {
      localStorage.removeItem('slotted_referrer');
      return;
    }
    if (referrerEmail && referrerEmail === firebaseUser.email) {
      localStorage.removeItem('slotted_referrer_email');
      return;
    }
    try {
      await api.post('/friends/connect-referral', referrerUid ? { referrerUid } : { referrerEmail });
    } catch (err) {
      console.error('Referral connect failed:', err instanceof Error ? err.message : err);
    } finally {
      localStorage.removeItem('slotted_referrer');
      localStorage.removeItem('slotted_referrer_email');
    }
  };

  const [isSigningIn, setIsSigningIn] = useState(false);

  const signInWithGoogle = async () => {
    if (isSigningIn) return null;
    setIsSigningIn(true);
    setAuthError(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const additionalInfo = getAdditionalUserInfo(result);
      if (additionalInfo?.isNewUser) {
        setIsNewUser(true);
        trackSignUp();
      } else {
        trackSignIn();
      }
      // Auto-connect with referrer after successful sign-in
      if (result.user) {
        await syncUserToDb(result.user);
        await connectReferral(result.user);
      }
      return result.user;
    } catch (err: unknown) {
      const firebaseErr = err as { code?: string; message?: string };
      console.error('Auth error:', firebaseErr.message || err);
      const code = firebaseErr.code || '';
      if (code === 'auth/unauthorized-domain') {
        setAuthError(
          `This domain isn't authorized in Firebase. Go to Firebase Console → Authentication → Settings → Authorized domains and add: ${window.location.hostname}`
        );
      } else if (code === 'auth/popup-closed-by-user') {
        setAuthError('Sign-in popup was closed. Please try again.');
      } else if (code === 'auth/popup-blocked') {
        // Fallback to redirect-based sign-in
        try {
          await signInWithRedirect(auth, googleProvider);
        } catch {
          setAuthError('Sign-in failed. Please try again.');
        }
      } else {
        setAuthError(`Sign-in failed: ${firebaseErr.message || code}`);
      }
      return null;
    } finally {
      setIsSigningIn(false);
    }
  };

  const clearNewUser = () => setIsNewUser(false);

  const completeOnboarding = () => {
    setOnboardingComplete(true);
    localStorage.setItem('slotted_onboarding_complete', 'true');
    trackOnboardingComplete();
  };

  const skipOnboarding = () => {
    setIsNewUser(false);
    trackOnboardingSkipped();
    // Don't mark complete — so the banner shows
  };

  const connectCalendar = useCallback(async () => {
    try {
      const { data } = await api.get('/calendar/auth-url');
      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error('Failed to get calendar auth URL:', err);
    }
  }, []);

  const disconnectCalendar = useCallback(async () => {
    try {
      await api.post('/calendar/disconnect');
      setGoogleCalendarConnected(false);
      localStorage.removeItem('slotted_google_calendar_connected');
      // Update generic connected state
      const { data } = await api.get('/calendar/status');
      if (!data?.connected) {
        setCalendarConnected(false);
        localStorage.removeItem('slotted_calendar_connected');
      }
    } catch (err) {
      console.error('Failed to disconnect calendar:', err);
    }
  }, []);

  const connectAppleCalendar = useCallback(async (username: string, password: string) => {
    try {
      const { data } = await api.post('/calendar/apple/connect', { username, password });
      if (data?.success) {
        setAppleCalendarConnected(true);
        setCalendarConnected(true);
        localStorage.setItem('slotted_apple_calendar_connected', 'true');
        localStorage.setItem('slotted_calendar_connected', 'true');
        trackCalendarConnected('apple');
        return { success: true, calendarsFound: data.calendarsFound };
      }
      return { success: false, error: 'Unknown error' };
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } }; message?: string };
      const errorMessage = axiosErr.response?.data?.error || axiosErr.message || 'Failed to connect Apple Calendar';
      return { success: false, error: errorMessage };
    }
  }, []);

  const disconnectAppleCalendar = useCallback(async () => {
    try {
      await api.post('/calendar/apple/disconnect');
      setAppleCalendarConnected(false);
      localStorage.removeItem('slotted_apple_calendar_connected');
      // Check if Google is still connected
      const { data } = await api.get('/calendar/status');
      if (!data?.connected) {
        setCalendarConnected(false);
        localStorage.removeItem('slotted_calendar_connected');
      }
    } catch (err) {
      console.error('Failed to disconnect Apple Calendar:', err);
    }
  }, []);

  const connectOutlookCalendar = useCallback(async () => {
    try {
      const { data } = await api.get('/calendar/outlook/auth-url');
      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error('Failed to get Outlook calendar auth URL:', err);
    }
  }, []);

  const disconnectOutlookCalendar = useCallback(async () => {
    try {
      await api.post('/calendar/outlook/disconnect');
      setOutlookCalendarConnected(false);
      localStorage.removeItem('slotted_outlook_calendar_connected');
      const { data } = await api.get('/calendar/status');
      if (!data?.connected) {
        setCalendarConnected(false);
        localStorage.removeItem('slotted_calendar_connected');
      }
    } catch (err) {
      console.error('Failed to disconnect Outlook Calendar:', err);
    }
  }, []);

  // Check real calendar connection status from API
  const checkCalendarStatus = useCallback(async () => {
    try {
      const { data } = await api.get('/calendar/status');
      const connected = !!data?.connected;
      setCalendarConnected(connected);
      if (connected) {
        localStorage.setItem('slotted_calendar_connected', 'true');
      } else {
        localStorage.removeItem('slotted_calendar_connected');
      }
      // Google-specific status
      const gConnected = !!data?.google;
      setGoogleCalendarConnected(gConnected);
      if (gConnected) {
        localStorage.setItem('slotted_google_calendar_connected', 'true');
      } else {
        localStorage.removeItem('slotted_google_calendar_connected');
      }
      // Apple-specific status
      const appleConnected = !!data?.apple;
      setAppleCalendarConnected(appleConnected);
      if (appleConnected) {
        localStorage.setItem('slotted_apple_calendar_connected', 'true');
      } else {
        localStorage.removeItem('slotted_apple_calendar_connected');
      }
      // Outlook-specific status
      const outlookConnected = !!data?.outlook;
      setOutlookCalendarConnected(outlookConnected);
      if (outlookConnected) {
        localStorage.setItem('slotted_outlook_calendar_connected', 'true');
      } else {
        localStorage.removeItem('slotted_outlook_calendar_connected');
      }
    } catch (err) {
      console.warn('Calendar status check failed:', err instanceof Error ? err.message : err);
    }
  }, []);

  // Verify calendar tokens are actually valid (makes a real API call)
  const verifyCalendarHealth = useCallback(async () => {
    try {
      const { data } = await api.get('/calendar/status?verify=true');
      if (data?.googleStale) {
        setGoogleCalendarStale(true);
        setGoogleCalendarConnected(false);
        localStorage.removeItem('slotted_google_calendar_connected');
      } else if (data?.google) {
        setGoogleCalendarStale(false);
      }
    } catch (err) {
      console.warn('Calendar health check failed:', err instanceof Error ? err.message : err);
    }
  }, []);

  // Check calendar status after auth is confirmed
  useEffect(() => {
    if (user) {
      checkCalendarStatus();
    }
  }, [user, checkCalendarStatus]);

  // Handle ?calendar=connected query param (after OAuth redirect)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('calendar') === 'connected') {
      setCalendarConnected(true);
      setCalendarJustConnected(true);
      localStorage.setItem('slotted_calendar_connected', 'true');
      // Refresh status from API to detect which provider was just connected
      checkCalendarStatus();
      setTimeout(() => setCalendarJustConnected(false), 3000);
      // Clean up the URL
      const url = new URL(window.location.href);
      url.searchParams.delete('calendar');
      window.history.replaceState({}, '', url.pathname);
    }
  }, [checkCalendarStatus]);

  const signOut = async () => {
    setIsNewUser(false);
    await firebaseSignOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, loading, authError, isNewUser, isSigningIn, onboardingComplete, calendarConnected, googleCalendarConnected, googleCalendarStale, calendarJustConnected, appleCalendarConnected, outlookCalendarConnected, clearNewUser, completeOnboarding, skipOnboarding, connectCalendar, disconnectCalendar, connectAppleCalendar, disconnectAppleCalendar, connectOutlookCalendar, disconnectOutlookCalendar, verifyCalendarHealth, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
