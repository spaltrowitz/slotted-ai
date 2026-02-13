import {
  createContext,
  useContext,
  useEffect,
  useState,
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

interface AuthContextType {
  user: User | null;
  loading: boolean;
  authError: string | null;
  isNewUser: boolean;
  onboardingComplete: boolean;
  calendarConnected: boolean;
  calendarJustConnected: boolean;
  clearNewUser: () => void;
  completeOnboarding: () => void;
  skipOnboarding: () => void;
  connectCalendar: () => void;
  disconnectCalendar: () => void;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isNewUser, setIsNewUser] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(() => {
    return localStorage.getItem('slotted_onboarding_complete') === 'true';
  });
  const [calendarConnected, setCalendarConnected] = useState(() => {
    return localStorage.getItem('slotted_calendar_connected') === 'true';
  });
  const [calendarJustConnected, setCalendarJustConnected] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
      // Ensure user record exists in DB on every session
      if (firebaseUser) {
        syncUserToDb(firebaseUser);
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
          connectReferral(result.user);
        }
      })
      .catch((err) => {
        console.error('Redirect result error:', err);
      });
  }, []);

  // Sync Firebase user to Supabase DB (upsert on every sign-in)
  const syncUserToDb = async (firebaseUser: User) => {
    try {
      const token = await firebaseUser.getIdToken();
      await fetch('/api/users/me', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
          photoUrl: firebaseUser.photoURL,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
    } catch (err) {
      console.error('User sync failed:', err);
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
      const token = await firebaseUser.getIdToken();
      await fetch('/api/friends/connect-referral', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(referrerUid ? { referrerUid } : { referrerEmail }),
      });
    } catch (err) {
      console.error('Referral connect failed:', err);
    } finally {
      localStorage.removeItem('slotted_referrer');
      localStorage.removeItem('slotted_referrer_email');
    }
  };

  const signInWithGoogle = async () => {
    setAuthError(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const additionalInfo = getAdditionalUserInfo(result);
      if (additionalInfo?.isNewUser) {
        setIsNewUser(true);
      }
      // Auto-connect with referrer after successful sign-in
      if (result.user) {
        await syncUserToDb(result.user);
        connectReferral(result.user);
      }
    } catch (err: any) {
      console.error('Auth error:', err);
      const code = err.code || '';
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
        } catch (redirectErr: any) {
          setAuthError('Sign-in failed. Please try again.');
        }
      } else {
        setAuthError(`Sign-in failed: ${err.message || code}`);
      }
    }
  };

  const clearNewUser = () => setIsNewUser(false);

  const completeOnboarding = () => {
    setOnboardingComplete(true);
    localStorage.setItem('slotted_onboarding_complete', 'true');
  };

  const skipOnboarding = () => {
    setIsNewUser(false);
    // Don't mark complete — so the banner shows
  };

  const connectCalendar = () => {
    // TODO: replace with real Google Calendar OAuth flow
    setCalendarConnected(true);
    localStorage.setItem('slotted_calendar_connected', 'true');
    setCalendarJustConnected(true);
    setTimeout(() => setCalendarJustConnected(false), 3000);
  };

  const disconnectCalendar = () => {
    setCalendarConnected(false);
    localStorage.removeItem('slotted_calendar_connected');
  };

  const signOut = async () => {
    setIsNewUser(false);
    await firebaseSignOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, loading, authError, isNewUser, onboardingComplete, calendarConnected, calendarJustConnected, clearNewUser, completeOnboarding, skipOnboarding, connectCalendar, disconnectCalendar, signInWithGoogle, signOut }}>
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
