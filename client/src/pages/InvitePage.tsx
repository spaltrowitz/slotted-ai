import { useEffect, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';

/**
 * /invite/:code — Resolves a personal invite code (e.g. "shari") to a Firebase UID,
 * stores it as the referrer, and redirects to the login page.
 */
export default function InvitePage() {
  const { code } = useParams<{ code: string }>();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!code) {
      setStatus('error');
      return;
    }

    (async () => {
      try {
        const res = await fetch(`/api/users/invite/${encodeURIComponent(code)}`);
        if (res.ok) {
          const data = await res.json();
          localStorage.setItem('slotted_referrer', data.uid);
          localStorage.removeItem('slotted_referrer_email');
        }
        // Even if the code is invalid, still redirect to login
        setStatus('ready');
      } catch {
        setStatus('ready');
      }
    })();
  }, [code]);

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f8f7f4]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-teal-500 border-t-transparent" />
      </div>
    );
  }

  return <Navigate to="/" replace />;
}
