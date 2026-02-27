import { Link } from 'react-router-dom';

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-[#f8f7f4]">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-btn text-sm font-bold text-white shadow-md">
            <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <span className="font-display text-xl font-bold tracking-tight text-gray-900">Slotted</span>
        </Link>
      </nav>

      {/* Content */}
      <main className="mx-auto max-w-3xl px-6 pb-16 pt-4">
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">
          Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-gray-400">Effective date: July 14, 2025</p>

        <div className="mt-8 space-y-8 text-sm leading-relaxed text-gray-600">
          {/* Intro */}
          <section>
            <p>
              Slotted ("we," "us," or "our") operates the web application at{' '}
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
                <h3 className="font-semibold text-gray-800">Google Calendar Data</h3>
                <p className="mt-1">
                  With your permission, we access your Google Calendar using the following scopes:
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>
                    <span className="font-medium text-gray-800">calendar.readonly</span> — to read
                    your calendar list
                  </li>
                  <li>
                    <span className="font-medium text-gray-800">calendar.events.readonly</span> — to
                    read your calendar events and determine your availability
                  </li>
                  <li>
                    <span className="font-medium text-gray-800">calendar.events</span> — to create
                    events on your calendar when you confirm plans with friends
                  </li>
                </ul>
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
              2. How We Use Google Calendar Data
            </h2>
            <div className="mt-3 space-y-2">
              <p>Your Google Calendar data is used solely to:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Determine your availability for scheduling suggestions</li>
                <li>Find mutual free times between you and your friends</li>
                <li>Add confirmed hangout plans to your calendar</li>
              </ul>
              <div className="mt-4 rounded-xl border border-teal-100 bg-teal-50/50 p-4">
                <p className="font-semibold text-teal-800">Important privacy commitments:</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-teal-700">
                  <li>
                    Calendar data is <span className="font-semibold">fetched live</span> from
                    Google's API each time it is needed — we do not store your calendar events in our
                    database.
                  </li>
                  <li>
                    Your calendar details, event titles, and descriptions are{' '}
                    <span className="font-semibold">never visible</span> to other users, including
                    your friends on Slotted.
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
                Google Calendar data is not persisted in our database. It is retrieved from the Google
                Calendar API in real time and used only for the duration of the request.
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
                other users of Slotted.
              </p>
            </div>
          </section>

          {/* 5 */}
          <section>
            <h2 className="font-display text-lg font-bold text-gray-900">5. Your Rights and Choices</h2>
            <div className="mt-3 space-y-4">
              <div>
                <h3 className="font-semibold text-gray-800">Revoke Google Calendar Access</h3>
                <p className="mt-1">
                  You can disconnect your Google Calendar at any time from the Settings page within
                  Slotted. You can also revoke Slotted's access to your Google Account by visiting{' '}
                  <a
                    href="https://myaccount.google.com/permissions"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-slotted-600 underline underline-offset-2 hover:text-slotted-800"
                  >
                    Google Account Permissions
                  </a>
                  .
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
              Slotted is not intended for use by anyone under the age of 13. We do not knowingly
              collect personal information from children under 13.
            </p>
          </section>

          {/* 8 */}
          <section>
            <h2 className="font-display text-lg font-bold text-gray-900">8. Changes to This Policy</h2>
            <p className="mt-3">
              We may update this Privacy Policy from time to time. If we make material changes, we
              will notify you through the app or by other means. Your continued use of Slotted after
              changes constitutes acceptance of the updated policy.
            </p>
          </section>

          {/* 9 */}
          <section>
            <h2 className="font-display text-lg font-bold text-gray-900">9. Contact Us</h2>
            <p className="mt-3">
              If you have questions about this Privacy Policy or your data, please contact us at:{' '}
              <a
                href="mailto:support@slotted-ai.web.app"
                className="font-medium text-slotted-600 underline underline-offset-2 hover:text-slotted-800"
              >
                support@slotted-ai.web.app
              </a>
            </p>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="pb-8 text-center">
        <Link to="/" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
          ← Back to Slotted
        </Link>
      </footer>
    </div>
  );
}
