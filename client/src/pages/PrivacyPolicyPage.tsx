import { Link } from 'react-router-dom';

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-page-warm">
      {/* Nav */}
      <nav className="flex items-center justify-between px-4 sm:px-8 py-5">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-btn text-sm font-bold text-white shadow-md">
            <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <span className="font-display text-xl font-bold tracking-tight text-gray-900">Slotted.ai</span>
        </Link>
      </nav>

      {/* Content */}
      <main className="mx-auto max-w-3xl px-6 pb-16 pt-4">
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">
          Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-gray-500">Effective date: February 1, 2026</p>

        <div className="mt-8 space-y-8 text-sm leading-relaxed text-gray-600">
          {/* Intro */}
          <section>
            <p>
              Slotted.ai ("we," "us," or "our") operates the web application at{' '}
              <span className="font-medium text-gray-900">slotted-ai.web.app</span>. This Privacy
              Policy explains what information we collect, how we use it, and your choices regarding
              your data.
            </p>
          </section>

          {/* 1 */}
          <section>
            <h2 className="font-display text-lg font-bold text-gray-900">1. Information We Collect</h2>
            <div className="mt-3 space-y-4">
              <div>
                <h3 className="font-semibold text-gray-800">Google Account Information</h3>
                <p className="mt-1">
                  When you sign in with Google, we receive your name, email address, and profile
                  picture through Firebase Authentication. This is used to create and identify your
                  account.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-gray-800">Calendar Data</h3>
                <p className="mt-1">
                  With your permission, we access your calendar from one or more of the following
                  providers:
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>
                    <span className="font-medium text-gray-800">Google Calendar</span> — via OAuth,
                    using scopes to read your calendar list, read events for availability, and create
                    events when you confirm plans
                  </li>
                  <li>
                    <span className="font-medium text-gray-800">Apple Calendar (iCloud)</span> — via
                    CalDAV, using an app-specific password you provide to read your events and
                    determine availability
                  </li>
                  <li>
                    <span className="font-medium text-gray-800">Microsoft Outlook</span> — support
                    planned for the future via Microsoft Graph API
                  </li>
                </ul>
                <p className="mt-2">
                  Regardless of provider, we use calendar data only to determine your availability
                  and create events you explicitly confirm. The same privacy commitments below apply
                  to all calendar sources.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-gray-800">User-Created Content</h3>
                <p className="mt-1">
                  Information you provide within the app, such as friend connections, scheduling
                  preferences, and social availability settings.
                </p>
              </div>
            </div>
          </section>

          {/* 2 */}
          <section>
            <h2 className="font-display text-lg font-bold text-gray-900">
              2. How We Use Calendar Data
            </h2>
            <div className="mt-3 space-y-2">
              <p>Your calendar data (from any connected provider) is used solely to:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Determine your availability for scheduling suggestions</li>
                <li>Find mutual free times between you and your friends</li>
                <li>Add confirmed hangout plans to your calendar</li>
              </ul>
              <div className="mt-4 rounded-xl border border-teal-100 bg-teal-50/50 p-4">
                <p className="font-semibold text-teal-800">Important privacy commitments:</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-teal-700">
                  <li>
                    Calendar data is <span className="font-semibold">fetched live</span> from your
                    calendar provider each time it is needed — we do not permanently store your
                    calendar events in our database.
                  </li>
                  <li>
                    Your calendar details, event titles, and descriptions are{' '}
                    <span className="font-semibold">never visible</span> to other users, including
                    your friends on Slotted.ai.
                  </li>
                  <li>
                    We only use calendar data to calculate availability — other users see only whether
                    you are free or busy, never what you are doing.
                  </li>
                </ul>
              </div>
            </div>
          </section>

          {/* 3 */}
          <section>
            <h2 className="font-display text-lg font-bold text-gray-900">3. Data Storage</h2>
            <div className="mt-3 space-y-2">
              <p>We use the following services to store and process your data:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  <span className="font-medium text-gray-800">Firebase Authentication</span> —
                  manages your sign-in session and authentication tokens
                </li>
                <li>
                  <span className="font-medium text-gray-800">Supabase (PostgreSQL)</span> — stores
                  your account profile, friend connections, scheduling preferences, and app data
                </li>
                <li>
                  <span className="font-medium text-gray-800">Firebase Cloud Functions</span> —
                  processes API requests on our server
                </li>
              </ul>
              <p className="mt-2">
                Google Calendar data is not persisted in our database. It is retrieved from the
                calendar provider's API in real time and used only for the duration of the request.
                For Apple Calendar connections, your CalDAV credentials are stored encrypted in our
                database to maintain the connection.
              </p>
            </div>
          </section>

          {/* 4 */}
          <section>
            <h2 className="font-display text-lg font-bold text-gray-900">4. Data Sharing</h2>
            <div className="mt-3 space-y-2">
              <p>We do not sell, rent, or share your personal data with third parties except:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  <span className="font-medium text-gray-800">Service providers</span> — Google
                  (Firebase, Google Calendar API) and Supabase, strictly for operating the app
                </li>
                <li>
                  <span className="font-medium text-gray-800">Legal requirements</span> — if
                  required by law, regulation, or legal process
                </li>
              </ul>
              <p className="mt-2">
                Your calendar details, social battery status, and friend activity are never exposed to
                other users of Slotted.ai.
              </p>
            </div>
          </section>

          {/* 5 */}
          <section>
            <h2 className="font-display text-lg font-bold text-gray-900">5. Your Rights and Choices</h2>
            <div className="mt-3 space-y-4">
              <div>
                <h3 className="font-semibold text-gray-800">Revoke Calendar Access</h3>
                <p className="mt-1">
                  You can disconnect your calendar at any time from the Settings page within
                  Slotted.ai. For Google Calendar, you can also revoke Slotted.ai's access by visiting{' '}
                  <a
                    href="https://myaccount.google.com/permissions"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-slotted-600 underline underline-offset-2 hover:text-slotted-800"
                  >
                    Google Account Permissions
                  </a>
                  . For Apple Calendar, you can revoke the app-specific password from your Apple ID
                  settings.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-gray-800">Delete Your Account</h3>
                <p className="mt-1">
                  You can request account deletion by contacting us at the email below. Upon
                  deletion, we will remove all your stored data from our systems.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-gray-800">Access Your Data</h3>
                <p className="mt-1">
                  You may request a copy of the personal data we hold about you by contacting us.
                </p>
              </div>
            </div>
          </section>

          {/* 6 */}
          <section>
            <h2 className="font-display text-lg font-bold text-gray-900">6. Data Security</h2>
            <p className="mt-3">
              We use industry-standard measures to protect your data, including encrypted
              connections (HTTPS), Firebase security rules, and Supabase Row-Level Security
              policies. However, no method of transmission or storage is 100% secure.
            </p>
          </section>

          {/* 7 */}
          <section>
            <h2 className="font-display text-lg font-bold text-gray-900">7. Children's Privacy</h2>
            <p className="mt-3">
              Slotted.ai is not intended for use by anyone under the age of 13. We do not knowingly
              collect personal information from children under 13.
            </p>
          </section>

          {/* 8 */}
          <section>
            <h2 className="font-display text-lg font-bold text-gray-900">8. Changes to This Policy</h2>
            <p className="mt-3">
              We may update this Privacy Policy from time to time. If we make material changes, we
              will notify you through the app or by other means. Your continued use of Slotted.ai after
              changes constitutes acceptance of the updated policy.
            </p>
          </section>

          {/* 9 */}
          <section>
            <h2 className="font-display text-lg font-bold text-gray-900">9. Contact Us</h2>
            <p className="mt-3">
              If you have questions about this Privacy Policy or your data, please contact us at:{' '}
              <a
                href="mailto:slotted.ai@gmail.com"
                className="font-medium text-slotted-600 underline underline-offset-2 hover:text-slotted-800"
              >
                slotted.ai@gmail.com
              </a>
            </p>
          </section>
        </div>
      </main>

      {/* Footer */}
      <div className="mx-auto mt-12 max-w-3xl border-t border-gray-200 px-6 pt-6 pb-8">
        <Link
          to="/"
          className="text-sm font-medium text-teal-600 hover:text-teal-700 transition-colors"
        >
          ← Back to Slotted.ai
        </Link>
      </div>
    </div>
  );
}
