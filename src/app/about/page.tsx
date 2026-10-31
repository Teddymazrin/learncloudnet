import type { Metadata } from "next";
import Link from "next/link";
export const metadata: Metadata = { title: "About" };

export default function About() {
  return (
    <div className="wrap prose">
      <h1>About Learn Cloud Net</h1>
      <p>Learn Cloud Net teaches Azure networking the way it's actually learned on the job: by fixing things. Each level gives you a small network, a problem, and a Cloud Shell. You fix it with real Azure CLI commands, and a live map shows what changed and where your packets went.</p>
      <h2>Who it's for</h2>
      <p>Anyone who works in Azure and wants networking to stop being the scary part. The Beginner tier assumes nothing beyond knowing what a VM is. By the end of Intermediate you'll have worked the faults that fill real support queues: NSG priority, layered NSGs, half-built and overlapping peerings, hub-and-spoke routing, stale next hops and private endpoint DNS. Advanced introduces gateway transit, service and private endpoints, custom DNS and Private DNS Resolver, NAT gateway, load balancer probes, the VM's own firewall and services, Azure Firewall and Bastion one at a time, then stacks them. Expert drops the hints and starts a clock, and sometimes the network turns out to be fine.</p>
      <h2>How accurate is it?</h2>
      <p>The simulator follows the behavior documented on Microsoft Learn, and each level links the pages behind it. It is still a simulator. It models a subset of <code>az network</code>, and it simplifies some things on purpose: there's no NAT through firewalls, the public internet is only modeled where a level needs it, and NSGs aren't re-evaluated on reply traffic. Terminal lines that start with <code>lab:</code> are the simulator explaining itself, not real Azure output.</p>
      <h2>Roadmap</h2>
      <p>All four tiers are live. Next: Azure Firewall application and DNAT rules, and public load balancers with outbound rules. See the <Link href="/learn/">learning path</Link>.</p>
      <h2>Not affiliated with Microsoft</h2>
      <p>Learn Cloud Net is an independent project. It isn't affiliated with, sponsored by, or endorsed by Microsoft.</p>
    </div>
  );
}
