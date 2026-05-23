import Link from "next/link";
import type { ReactNode } from "react";

export function PageShell({
  children,
  wide = false
}: {
  children: ReactNode;
  wide?: boolean;
}) {
  return <main className={wide ? "feed-shell wide" : "feed-shell"}>{children}</main>;
}

export function PageHeader({
  eyebrow,
  title,
  action
}: {
  action?: ReactNode;
  eyebrow: string;
  title: string;
}) {
  return (
    <header className="feed-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {action ?? <Link href="/">Home</Link>}
    </header>
  );
}

export function Gate({
  buttonLabel = "Back home",
  message,
  title
}: {
  buttonLabel?: string;
  message: string;
  title: string;
}) {
  return (
    <main className="auth-shell">
      <section className="panel">
        <h1>{title}</h1>
        <p>{message}</p>
        <Link className="button" href="/">
          {buttonLabel}
        </Link>
      </section>
    </main>
  );
}

export function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

export function StatusPill({ children }: { children: ReactNode }) {
  return <span className="status-pill">{children}</span>;
}
