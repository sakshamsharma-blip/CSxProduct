import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { BrandLogo } from '../components/BrandLogo';
import { ROLE_LABELS, UserRole } from '../types';

// Path Supabase Auth sends people to when an app (e.g. Claude, via the Flow
// MCP server) asks to act on their behalf. Must match "Authorization Path"
// in Supabase → Authentication → OAuth Server.
export const OAUTH_CONSENT_PATH = '/oauth/consent';

type Details = {
  clientName: string;
  clientUri: string | null;
  redirectUri: string;
  scope: string;
};

/**
 * Consent screen for Supabase's OAuth 2.1 server. Shown only to a signed-in
 * user (App.tsx shows the normal login first). Approving issues an
 * authorization code bound to *this* user, so the app acting on their
 * behalf gets exactly their role's permissions — no more.
 */
export function OAuthConsentPage() {
  const { appUser, user, signOut } = useAuth();
  const authorizationId = new URLSearchParams(window.location.search).get('authorization_id');

  const [details, setDetails] = useState<Details | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!authorizationId) {
      setError('This link is missing its authorization request. Start the connection again from Claude.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
      if (cancelled) return;
      if (error || !data) {
        setError(error?.message || 'This authorization request has expired or is invalid. Start the connection again from Claude.');
        setLoading(false);
        return;
      }
      if (!('authorization_id' in data)) {
        // Already approved earlier for these permissions — go straight back.
        window.location.href = data.redirect_url;
        return;
      }
      setDetails({
        clientName: data.client?.name || 'An application',
        clientUri: data.client?.uri || null,
        redirectUri: data.redirect_uri,
        scope: data.scope,
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    if (!authorizationId) return;
    setBusy(true);
    setError('');
    const { data, error } = approve
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
    if (error || !data?.redirect_url) {
      setError(error?.message || 'Something went wrong. Please try again.');
      setBusy(false);
      return;
    }
    window.location.href = data.redirect_url;
  }

  async function switchAccount() {
    // Sign out but stay on this URL, so the login form comes back and the
    // same request can be approved with the right account.
    await signOut();
  }

  const redirectHost = (() => {
    try { return details ? new URL(details.redirectUri).host : ''; } catch { return details?.redirectUri ?? ''; }
  })();

  return (
    <div className="min-h-screen flex items-center justify-center bg-blue-50 px-4">
      <div className="max-w-md w-full">
        <div className="flex flex-col items-center mb-8">
          <BrandLogo size="lg" />
          <p className="text-gray-500 mt-3 text-center">
            <span className="font-semibold text-gray-700">Flow</span> — Internal Escalation Tracking
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-md p-8">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : !details ? (
            <>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Can't continue</h2>
              <div className="bg-red-50 text-red-700 px-3 py-2 rounded-md text-sm">{error}</div>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">
                Allow {details.clientName} to use Flow as you?
              </h2>
              <p className="text-sm text-gray-500 mb-5">
                {details.clientUri ? <>{details.clientUri} · </> : null}will return to <span className="font-mono">{redirectHost}</span>
              </p>

              <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3 mb-5 text-sm">
                <p className="text-gray-500 text-xs uppercase tracking-wide mb-1">Signed in as</p>
                <p className="font-medium text-gray-900">{appUser?.full_name || user?.email}</p>
                <p className="text-gray-600">
                  {user?.email}
                  {appUser?.role && <> · {ROLE_LABELS[appUser.role as UserRole]}</>}
                </p>
                <button onClick={switchAccount} disabled={busy} className="mt-2 text-xs text-blue-600 hover:text-blue-800 hover:underline">
                  Not you? Use a different account
                </button>
              </div>

              <p className="text-sm text-gray-700 mb-2">It will be able to:</p>
              <ul className="text-sm text-gray-700 list-disc pl-5 space-y-1 mb-5">
                <li>See the tickets and timelines you can see (and analytics, if your role has them)</li>
                <li>Create tickets, comment, and change stage, priority, sprint or assignee — only where your role allows</li>
              </ul>
              <p className="text-xs text-gray-500 mb-5">
                Changes it makes are recorded in the ticket timeline under your name. You can disconnect it at any time from the app you're connecting.
              </p>

              {error && (
                <div className="bg-red-50 text-red-700 px-3 py-2 rounded-md text-sm mb-4">{error}</div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => decide(true)}
                  disabled={busy}
                  className="flex-1 bg-green-600 text-white py-2 px-4 rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {busy ? 'Please wait…' : 'Allow'}
                </button>
                <button
                  onClick={() => decide(false)}
                  disabled={busy}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  Deny
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
