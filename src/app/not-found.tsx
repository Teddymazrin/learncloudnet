import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "No route to host" };

export default function NotFound() {
  return (
    <div className="wrap lost">
      <svg width="120" height="64" viewBox="0 0 120 64" aria-hidden="true">
        <path d="M10 40 H50" stroke="var(--ok)" strokeWidth="4" strokeLinecap="round" />
        <path d="M58 40 H76" stroke="var(--bad)" strokeWidth="4" strokeLinecap="round" strokeDasharray="2 7" />
        <path d="M80 32 l12 12 M92 32 l-12 12" stroke="var(--bad)" strokeWidth="4" strokeLinecap="round" />
        <circle cx="10" cy="40" r="7" fill="var(--accent)" />
      </svg>
      <h1>No route to host</h1>
      <p className="muted" style={{ margin: 0 }}>This page doesn&apos;t exist. The packet got this far and stopped.</p>
      <div className="row">
        <Link className="btn primary" href="/learn/">Back to the learning path</Link>
        <Link className="btn" href="/">Home</Link>
      </div>
    </div>
  );
}
