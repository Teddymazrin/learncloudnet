import Link from "next/link";
import { LEVELS, getLevel } from "@/content";
import { run } from "@/sim/shell";
import { newSession } from "@/sim/types";
import { TierCards } from "@/components/TierCards";
import { PacketRun } from "@/components/PacketRun";
import { NetBackground } from "@/components/NetBackground";

// Run a real level through the simulator at build time so the demo is genuine output.
function demo() {
  const level = getLevel("first-match-wins")!;
  const st = level.setup();
  const s = newSession();
  const cmds = [
    "az network watcher test-ip-flow -g rg-lab --vm vm-web --direction Inbound --protocol TCP --local 10.1.1.4:443 --remote 10.1.2.4:*",
    "az network nsg rule update -g rg-lab --nsg-name nsg-web --name Allow-HTTPS-Client --priority 150 --query priority",
    "ssh vm-client",
    "nc -zv 10.1.1.4 443",
  ];
  return cmds.map((c) => {
    const prompt = s.vm ? `azureuser@${s.vm}:~$` : "cloudshell:~$";
    const r = run(st, c, s);
    return { prompt, c, out: r.text };
  });
}

export default function Home() {
  const lines = demo();
  return (
    <>
    <NetBackground />
    <div className="wrap home">
      <section className="hero">
        <div>
          <h1 className="hero-brand">Learn Cloud Net</h1>
          <p className="hero-tag">Learn Azure networking by <em>fixing it.</em></p>
          <p className="lede">It takes you from your first virtual network to hub-and-spoke routing and private endpoint DNS. You type real Azure CLI commands into a simulated Cloud Shell, watch a live network map react, and fix real Azure networking issues.</p>
          <Link className="btn primary hero-cta" href="/learn/">Start learning</Link>
          <p className="note" style={{ marginTop: 14 }}>Free, no account, no Azure subscription needed. Progress saves in your browser.</p>
        </div>
        <div className="demo" aria-label="Example level being solved">
          <span className="m">Intermediate · HTTPS blocked despite an allow rule</span>{"\n\n"}
          {lines.map((l, i) => (
            <span key={i}>
              <span className="c">{l.prompt} {l.c}</span>{"\n"}
              <span className={/succeeded/.test(l.out) ? "g" : /Deny/.test(l.out) ? "r" : ""}>{l.out}</span>{"\n\n"}
            </span>
          ))}
        </div>
      </section>

      <PacketRun />

      <section className="section">
        <h2>Beginner to advanced, in four tiers</h2>
        <p className="muted" style={{ margin: 0 }}>{LEVELS.length} levels. Start at the beginning, or pick the tier that matches what you already know.</p>
        <TierCards />
      </section>

      <section className="section">
        <h2>How it works</h2>
        <div className="how">
          <div><b>Real commands</b><span className="muted">The terminal speaks a real subset of <code>az network</code>. What you type here works against a real subscription.</span></div>
          <div><b>Checked by outcome</b><span className="muted">Levels check the network you end up with, not the exact command, so any valid fix passes, the way real troubleshooting works.</span></div>
          <div><b>Sourced from Microsoft Learn</b><span className="muted">Every rule the simulator follows comes from Microsoft Learn, and each level links the pages behind it.</span></div>
        </div>
      </section>
    </div>
    </>
  );
}
