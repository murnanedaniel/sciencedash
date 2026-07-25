import { terminalEnabled } from "@/lib/config";
import { TerminalPane } from "@/components/TerminalPane";

export const dynamic = "force-dynamic";

/**
 * /terminal — an interactive shell on the box, reachable from the dashboard.
 *
 * Its reason to exist: the dashboard runs the local `claude` binary for every
 * AI feature. When that login expires you need shell access to run
 * `claude setup-token` and paste the auth code back — but the machine may
 * only be reachable through this dashboard over Tailscale, with no SSH.
 *
 * Gated by SCIENCEDASH_TERMINAL_ENABLED. Auth is enforced by proxy.ts, so
 * only a logged-in session (or bearer token) ever reaches this page.
 */
export default function TerminalPage() {
  if (!terminalEnabled()) {
    return (
      <div className="container">
        <header className="pageHead">
          <h1 className="pageTitle">Terminal</h1>
          <p className="pageSub">Remote shell access — disabled.</p>
        </header>
        <div className="card">
          <p className="muted">
            The web terminal is disabled because{" "}
            <code>SCIENCEDASH_TERMINAL_ENABLED</code> is set to{" "}
            <code>0</code>. Remove that override (it&apos;s on by default) and
            restart the server to re-enable it.
          </p>
          <p className="muted small" style={{ marginTop: 8 }}>
            It opens a real shell on this machine as the server user — used to
            re-run <code>claude setup-token</code> when a login times out and
            the box is only reachable through the dashboard.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <header className="pageHead">
        <h1 className="pageTitle">Terminal</h1>
        <p className="pageSub">
          A live shell on this machine as the server user. To re-authenticate
          Claude Code after a timeout, run <code>claude setup-token</code>, open
          the printed URL, and paste the code back here.
        </p>
      </header>
      <div className="card">
        <TerminalPane />
      </div>
    </div>
  );
}
