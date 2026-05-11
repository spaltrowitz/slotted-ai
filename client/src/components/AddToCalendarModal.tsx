import { useState } from 'react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

interface AddToCalendarModalProps {
  meetupId: string;
  meetupTitle: string;
  startTime: string;
  endTime: string;
  onClose: () => void;
  onAdded?: () => void;
}

/** Build a Google Calendar deep link that opens the "create event" UI with pre-filled details */
function formatTimeZoneLabel(startTime: string): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || new Date(startTime).toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop() || 'your timezone';
}

function buildGoogleCalendarLink(title: string, startTime: string, endTime: string): string {
  const fmt = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${fmt(startTime)}/${fmt(endTime)}`,
    details: `Scheduled via Slotted.ai. Times display in ${formatTimeZoneLabel(startTime)}.`,
  });
  return `https://www.google.com/calendar/render?${params.toString()}`;
}

/** Generate an ICS file string */
function buildIcsContent(title: string, startTime: string, endTime: string): string {
  const uid = `slotted-${Date.now()}@slotted-ai.web.app`;
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dtStart = new Date(startTime).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dtEnd = new Date(endTime).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Slotted.ai//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:Scheduled via Slotted.ai. Times display in ${formatTimeZoneLabel(startTime)}.`,
    'BEGIN:VALARM',
    'TRIGGER:-PT60M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${title} in 1 hour`,
    'END:VALARM',
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${title} in 15 minutes`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

export default function AddToCalendarModal({
  meetupTitle,
  startTime,
  endTime,
  onClose,
  onAdded,
}: AddToCalendarModalProps) {
  const [added, setAdded] = useState(false);
  const [addedMethod, setAddedMethod] = useState<'google' | 'ics' | null>(null);
  useBodyScrollLock(true);

  const handleGoogleCalendar = () => {
    window.open(buildGoogleCalendarLink(meetupTitle, startTime, endTime), '_blank');
    setAdded(true);
    setAddedMethod('google');
    onAdded?.();
    setTimeout(() => onClose(), 2500);
  };

  const handleDownloadIcs = () => {
    const icsContent = buildIcsContent(meetupTitle, startTime, endTime);
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${meetupTitle.replace(/[^a-zA-Z0-9]/g, '_')}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setAdded(true);
    setAddedMethod('ics');
    onAdded?.();
    setTimeout(() => onClose(), 2500);
  };

  const formatTime = (dt: string) => {
    const d = new Date(dt);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
      ' at ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-[calc(100vw-1.5rem)] sm:max-w-md rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden animate-in zoom-in-95 fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-gray-100 bg-gradient-to-r from-slotted-50/50 to-indigo-50/50 px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display text-base font-bold text-gray-900">Add to Calendar</h3>
              <p className="mt-0.5 text-xs text-gray-500">Save this meetup to your calendar</p>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-200 p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-500 hover:bg-gray-100 hover:text-gray-600 transition-all"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Event summary */}
        <div className="border-b border-gray-100 bg-gray-50/50 px-4 py-3 sm:px-6">
          <p className="text-sm font-semibold text-gray-900">{meetupTitle}</p>
          <p className="text-xs text-gray-500">{formatTime(startTime)}</p>
        </div>

        {/* Content */}
        <div className="px-4 py-4 sm:px-6">
          {added ? (
            <div className="flex flex-col items-center justify-center py-8">
              <span className="text-4xl">✅</span>
              <p className="mt-2 text-sm font-semibold text-emerald-700">
                {addedMethod === 'google' ? 'Google Calendar opened!' : 'Calendar file downloaded!'}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {addedMethod === 'google'
                  ? `Save it to the calendar you want. The time is shown in ${formatTimeZoneLabel(startTime)}.`
                  : `Open the .ics file in Apple Calendar, Outlook, or another calendar app. The event uses ${formatTimeZoneLabel(startTime)}.`}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Google Calendar */}
              <button
                onClick={handleGoogleCalendar}
                className="flex min-h-[44px] w-full items-center gap-3 rounded-xl border border-gray-200 px-4 py-3.5 text-left transition-all hover:border-blue-300 hover:bg-blue-50/50 hover:shadow-sm"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 shrink-0">
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">Google Calendar</p>
                  <p className="text-[11px] text-gray-500">Opens in a new tab; choose the exact Google calendar before saving</p>
                </div>
                <svg className="ml-auto h-4 w-4 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </button>

              {/* Download .ics */}
              <button
                onClick={handleDownloadIcs}
                className="flex min-h-[44px] w-full items-center gap-3 rounded-xl border border-gray-200 px-4 py-3.5 text-left transition-all hover:border-gray-300 hover:bg-gray-50/50 hover:shadow-sm"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100 shrink-0 text-lg">
                  📥
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">Download .ics file</p>
                  <p className="text-[11px] text-gray-500">Works with Apple Calendar, Outlook, or any calendar app</p>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {!added && (
          <div className="flex justify-end border-t border-gray-100 px-4 py-3 sm:px-6">
            <button
              onClick={onClose}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 transition-all"
            >
              Skip
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
