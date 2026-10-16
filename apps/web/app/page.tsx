export default function HomePage() {
  return (
    <main className="shell">
      <p className="eyebrow">DEVNET · MILESTONE 1</p>
      <h1>Solana Trading System</h1>
      <p className="lede">Infrastructure scaffold is online. Trading and signing are disabled.</p>
      <section className="panel" aria-labelledby="status-heading">
        <h2 id="status-heading">System status</h2>
        <dl>
          <div><dt>Network default</dt><dd>Devnet</dd></div>
          <div><dt>Execution router</dt><dd>Not enabled</dd></div>
          <div><dt>Signer access</dt><dd>Not configured</dd></div>
          <div><dt>Safety policy</dt><dd>Fail closed</dd></div>
        </dl>
      </section>
    </main>
  );
}
