/**
 * /login — single-input password form. Posts to /api/auth/login which
 * validates the password, sets a session cookie, and 303-redirects
 * back to ?next= (or `/`).
 *
 * Server component. No JS required to log in.
 */

type SearchParams = Promise<{
  next?: string | string[];
  error?: string | string[];
}>;

function asString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const next = asString(sp.next) ?? "/";
  // Only allow same-origin redirects after login (defence against
  // open-redirect via a crafted ?next=https://evil.example).
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const showError = asString(sp.error) === "1";

  return (
    <div className="container" style={{ maxWidth: 380, marginTop: 80 }}>
      <header className="pageHead" style={{ borderBottom: "none" }}>
        <h1 className="pageTitle">ScienceDash</h1>
        <p className="pageSub muted small">Sign in to continue.</p>
      </header>

      <form
        action="/api/auth/login"
        method="post"
        className="card stack"
        style={{ marginTop: 12 }}
      >
        <input type="hidden" name="next" value={safeNext} />
        <label className="field">
          <span className="muted small">Password</span>
          <input
            type="password"
            name="password"
            required
            autoFocus
            autoComplete="current-password"
            style={{ fontSize: 14 }}
          />
        </label>
        {showError ? (
          <p
            className="small"
            style={{ color: "var(--red, #c0322a)", marginTop: 0 }}
          >
            Wrong password.
          </p>
        ) : null}
        <button type="submit" className="button">
          Sign in
        </button>
        <p className="muted small" style={{ marginTop: 6 }}>
          Single-user dashboard. One password, one device login that lasts a
          year.
        </p>
      </form>
    </div>
  );
}
