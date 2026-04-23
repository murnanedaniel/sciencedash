export default function SettingsPage() {
  return (
    <div className="container">
      <header className="pageHead">
        <h1 className="pageTitle">Settings</h1>
        <p className="pageSub">Integrations and worker health land here in M3.</p>
      </header>
      <div className="card muted">
        <p>Upcoming in M3:</p>
        <ul style={{ marginTop: 8, marginLeft: 18 }}>
          <li>Anthropic / W&amp;B / GitHub API key status (write-only)</li>
          <li>In-process worker heartbeat and last-run job log</li>
          <li>Prompt template editor</li>
          <li>Per-project AI auto-review toggles</li>
        </ul>
      </div>
    </div>
  );
}
