import { Link } from 'react-router-dom';

export default function TermsOfServicePage() {
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
          Terms of Service
        </h1>
        <p className="mt-2 text-sm text-gray-500">Effective date: February 1, 2026</p>

        <div className="mt-8 space-y-8 text-sm leading-relaxed text-gray-600">
          <section>
            <p>
              Welcome to Slotted.ai. By accessing or using the Slotted.ai web application at{' '}
              <span className="font-medium text-gray-900">slottedapp.com</span> (the
              "Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not
              agree, please do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-gray-900">1. Description of Service</h2>
            <p className="mt-2">
              Slotted.ai is a calendar-based scheduling tool that helps you find mutual free time with
              friends and make plans. The Service connects to your calendar (Google Calendar, Apple
              Calendar via iCloud, and in the future Microsoft Outlook), analyzes availability, and
              suggests times to meet.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-gray-900">2. Eligibility</h2>
            <p className="mt-2">
              You must be at least 13 years old to use Slotted.ai. By using the Service, you represent
              that you meet this requirement.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-gray-900">3. Account & Authentication</h2>
            <p className="mt-2">
              You sign in using your Google account via Firebase Authentication. You are responsible
              for maintaining the security of your account credentials. You agree not to share your
              account or let others access the Service through your account.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-gray-900">4. Calendar Access</h2>
            <p className="mt-2">
              Slotted.ai requests access to your calendar (via Google OAuth, Apple CalDAV, or other
              supported providers) to read your free/busy status and create events on your behalf
              when you confirm a plan. You can disconnect your calendar at any time from the Settings
              page. See our{' '}
              <Link to="/privacy" className="font-medium text-teal-600 hover:text-teal-700 underline underline-offset-2">
                Privacy Policy
              </Link>{' '}
              for details on how we handle your calendar data.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-gray-900">5. Acceptable Use</h2>
            <p className="mt-2">You agree not to:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Use the Service for any unlawful purpose</li>
              <li>Attempt to gain unauthorized access to the Service or its systems</li>
              <li>Interfere with or disrupt the Service for other users</li>
              <li>Scrape, crawl, or use automated means to access the Service</li>
              <li>Impersonate another person or misrepresent your identity</li>
              <li>Use the Service to spam, harass, or pressure other users</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-gray-900">6. Intellectual Property</h2>
            <p className="mt-2">
              The Service, including its design, code, and branding, is owned by Slotted.ai. You retain
              ownership of your personal data. By using the Service, you grant us a limited license
              to process your data as described in our Privacy Policy.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-gray-900">7. AI-Generated Suggestions</h2>
            <p className="mt-2">
              Slotted.ai uses AI to suggest meeting times and activities. These suggestions are
              provided as-is and are not guaranteed to be accurate, appropriate, or available.
              You are responsible for confirming and finalizing any plans.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-gray-900">8. Availability & Changes</h2>
            <p className="mt-2">
              We strive to keep the Service available but do not guarantee uninterrupted access. We
              may modify, suspend, or discontinue features at any time. We will make reasonable
              efforts to notify users of significant changes.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-gray-900">9. Limitation of Liability</h2>
            <p className="mt-2">
              To the maximum extent permitted by law, Slotted.ai is provided "as is" without
              warranties of any kind. We are not liable for any indirect, incidental, or
              consequential damages arising from your use of the Service, including missed meetings,
              scheduling conflicts, or calendar data issues.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-gray-900">10. Termination</h2>
            <p className="mt-2">
              You may stop using the Service at any time. We may suspend or terminate your access
              if you violate these Terms. Upon termination, your right to use the Service ceases
              immediately. You can request deletion of your data by contacting us.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-gray-900">11. Changes to These Terms</h2>
            <p className="mt-2">
              We may update these Terms from time to time. If we make material changes, we will
              notify you through the Service. Continued use after changes constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-gray-900">12. Contact</h2>
            <p className="mt-2">
              Questions about these Terms? Reach us at{' '}
              <a
                href="mailto:slotted.ai@gmail.com"
                className="font-medium text-slotted-600 underline underline-offset-2 hover:text-slotted-800"
              >
                slotted.ai@gmail.com
              </a>
              .
            </p>
          </section>
        </div>

        <div className="mt-12 border-t border-gray-200 pt-6">
          <Link
            to="/"
            className="text-sm font-medium text-teal-600 hover:text-teal-700 transition-colors"
          >
            ← Back to Slotted.ai
          </Link>
        </div>
      </main>
    </div>
  );
}
