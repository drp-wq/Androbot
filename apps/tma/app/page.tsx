export default function MiniAppHome() {
  return (
    <main className="screen">
      <p className="eyebrow">SOLANA SYSTEM</p>
      <h1>Trading status</h1>
      <p>
        Read-only Mini App shell. Paper/simulation trading is the default and no real funds are moved. Server-side
        Telegram initData validation is required before any authenticated actions are added.
      </p>
      <div className="status" role="status">
        <span aria-hidden="true" /> Paper mode · Devnet
      </div>
      <p className="disclaimer">
        Memecoin trading is adversarial. This is not a profit guarantee and no live execution is enabled.
      </p>
    </main>
  );
}
