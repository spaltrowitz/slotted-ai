import { useState, useEffect, useCallback } from 'react';
import { getToken, onMessage } from 'firebase/messaging';
import { getMessagingInstance } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';

export function usePushNotifications() {
  const { user } = useAuth();
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Check current permission status
  useEffect(() => {
    if ('Notification' in window) {
      setPermission(Notification.permission);
    }
  }, []);

  // Request notification permission and get FCM token
  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) {
      setError('This browser does not support push notifications');
      return false;
    }

    setLoading(true);
    setError(null);

    try {
      const permission = await Notification.requestPermission();
      setPermission(permission);

      if (permission !== 'granted') {
        setError('Notification permission denied');
        return false;
      }

      // Get Firebase Cloud Messaging instance
      const messaging = await getMessagingInstance();
      if (!messaging) {
        setError('Firebase Messaging not supported');
        return false;
      }

      // Get FCM token
      // VAPID key must be generated in Firebase Console > Project Settings > Cloud Messaging > Web Push certificates
      const token = await getToken(messaging, {
        vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY || 'YOUR_VAPID_KEY_HERE',
      });

      if (token) {
        console.log('FCM Token:', token);
        setFcmToken(token);

        // Save token to backend
        if (user) {
          await api.post('/users/me/fcm-token', { token });
        }

        return true;
      } else {
        setError('No FCM token available');
        return false;
      }
    } catch (err: any) {
      console.error('Error requesting notification permission:', err);
      setError(err.message || 'Failed to enable notifications');
      return false;
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Listen for foreground messages
  useEffect(() => {
    if (permission !== 'granted') return;

    let unsubscribe: (() => void) | undefined;

    (async () => {
      const messaging = await getMessagingInstance();
      if (!messaging) return;

      unsubscribe = onMessage(messaging, (payload) => {
        console.log('Foreground message received:', payload);

        // Show notification even when app is open
        if (payload.notification) {
          new Notification(payload.notification.title || 'New notification', {
            body: payload.notification.body,
            icon: '/icon-192.png',
            tag: payload.data?.notificationId || 'default',
          });
        }
      });
    })();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [permission]);

  // If permission is already granted, try to get the FCM token on mount
  // so the UI can distinguish "fully working" from "partial"
  useEffect(() => {
    if (permission !== 'granted' || fcmToken || !user) return;

    let cancelled = false;
    (async () => {
      try {
        const messaging = await getMessagingInstance();
        if (!messaging || cancelled) return;
        const token = await getToken(messaging, {
          vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY || 'YOUR_VAPID_KEY_HERE',
        });
        if (token && !cancelled) {
          setFcmToken(token);
          await api.post('/users/me/fcm-token', { token });
        }
      } catch {
        // Silently fail — the UI will show "partial" state
      }
    })();
    return () => { cancelled = true; };
  }, [permission, user]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    permission,
    fcmToken,
    error,
    loading,
    requestPermission,
    isSupported: 'Notification' in window,
  };
}
