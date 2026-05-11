import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import api from '../lib/api';
import { trackCalendarConnected } from '../lib/analytics';
import { useAuth } from './AuthContext';

interface CalendarContextType {
  calendarConnected: boolean;
  googleCalendarConnected: boolean;
  googleCalendarStale: boolean;
  calendarJustConnected: boolean;
  appleCalendarConnected: boolean;
  outlookCalendarConnected: boolean;
  connectCalendar: () => Promise<void>;
  disconnectCalendar: () => Promise<void>;
  connectAppleCalendar: (username: string, password: string) => Promise<{ success: boolean; error?: string; calendarsFound?: number }>;
  disconnectAppleCalendar: () => Promise<void>;
  connectOutlookCalendar: () => Promise<void>;
  disconnectOutlookCalendar: () => Promise<void>;
  verifyCalendarHealth: () => Promise<void>;
}

const CalendarContext = createContext<CalendarContextType | undefined>(undefined);

export function CalendarProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

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
      const gConnected = !!data?.google;
      setGoogleCalendarConnected(gConnected);
      if (gConnected) {
        localStorage.setItem('slotted_google_calendar_connected', 'true');
      } else {
        localStorage.removeItem('slotted_google_calendar_connected');
      }
      const appleConn = !!data?.apple;
      setAppleCalendarConnected(appleConn);
      if (appleConn) {
        localStorage.setItem('slotted_apple_calendar_connected', 'true');
      } else {
        localStorage.removeItem('slotted_apple_calendar_connected');
      }
      const outlookConn = !!data?.outlook;
      setOutlookCalendarConnected(outlookConn);
      if (outlookConn) {
        localStorage.setItem('slotted_outlook_calendar_connected', 'true');
      } else {
        localStorage.removeItem('slotted_outlook_calendar_connected');
      }
    } catch (err) {
      console.warn('Calendar status check failed:', err instanceof Error ? err.message : err);
    }
  }, []);

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
      checkCalendarStatus();
      setTimeout(() => setCalendarJustConnected(false), 3000);
      const pendingEventInviteToken = localStorage.getItem('slotted_pending_event_invite');
      if (pendingEventInviteToken) {
        localStorage.removeItem('slotted_pending_event_invite');
        window.location.replace(`/event-invite/${pendingEventInviteToken}`);
        return;
      }
      const url = new URL(window.location.href);
      url.searchParams.delete('calendar');
      window.history.replaceState({}, '', url.pathname);
    }
  }, [checkCalendarStatus]);

  return (
    <CalendarContext.Provider value={{
      calendarConnected, googleCalendarConnected, googleCalendarStale,
      calendarJustConnected, appleCalendarConnected, outlookCalendarConnected,
      connectCalendar, disconnectCalendar, connectAppleCalendar,
      disconnectAppleCalendar, connectOutlookCalendar, disconnectOutlookCalendar,
      verifyCalendarHealth,
    }}>
      {children}
    </CalendarContext.Provider>
  );
}

export function useCalendar() {
  const context = useContext(CalendarContext);
  if (!context) {
    throw new Error('useCalendar must be used within a CalendarProvider');
  }
  return context;
}
