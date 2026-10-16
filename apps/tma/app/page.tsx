export default function MiniAppHome() {
  return (
    <main className="screen">
      <p className="eyebrow">SOLANA SYSTEM</p>
      <h1>Trading status</h1>
      <p>Read-only Mini App shell. Server-side Telegram initData validation is required before any authenticated actions are added.</p>
      <div className="status" role="status"><span aria-hidden="true" /> Trading disabled · Devnet</div>
    </main>
  );
}
