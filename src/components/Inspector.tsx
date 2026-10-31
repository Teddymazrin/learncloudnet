"use client";
import { cidr, lastAddr, n2ip, usable } from "@/sim/ip";
import { HOP_LABEL, effectiveRoutes, evalNsg, findLink, lookup, nsgRules, peeringState, peeringsOf } from "@/sim/network";
import { ip2n } from "@/sim/ip";
import { EXPLAIN, type ExplainKind } from "@/content/explain";
import type { FlowResult } from "@/content/flows";
import type { Direction, State } from "@/sim/types";
import type { Selection } from "./NetworkMap";

function Rules({ st, nsg, dir, marks = {}, skips = {} }: { st: State; nsg: string; dir: Direction; marks?: Record<string, string[]>; skips?: Record<string, string[]> }) {
  return (
    <div className="table-wrap">
      <table className="mini">
        <thead><tr><th>Priority</th><th>Name</th><th>Source</th><th>Port</th><th>Access</th><th>Protocol</th><th></th></tr></thead>
        <tbody>
          {nsgRules(st, nsg, dir).flatMap((r) => [
            <tr key={r.name} className={(r.def ? "def" : "") + (marks[r.name] ? " hit" : "")}>
              <td>{r.priority}</td><td className="wrap">{r.name}</td><td className="src">{r.src.join(" ")}</td><td>{r.ports.join(" ")}</td><td className={r.access === "Allow" ? "allow" : "deny"}>{r.access}</td><td>{r.protocol}</td>
              <td>{marks[r.name] ? `◀ decides ${marks[r.name].join(", ")}` : ""}</td>
            </tr>,
            ...(skips[r.name] ? [<tr key={`${r.name}-skip`} className="skip-row"><td colSpan={7}>↳ Skipped: {skips[r.name].join("; ")}</td></tr>] : []),
          ])}
        </tbody>
      </table>
    </div>
  );
}

function Routes({ st, vnet, subnet, marks = {} }: { st: State; vnet: string; subnet: string; marks?: Record<number, string[]> }) {
  return (
    <div className="table-wrap">
      <table className="mini">
        <thead><tr><th>Source</th><th>State</th><th>Prefix</th><th>Next hop</th><th>IP</th><th></th></tr></thead>
        <tbody>
          {effectiveRoutes(st, vnet, subnet).map((r, k) => (
            <tr key={k} className={(r.state === "Invalid" ? "def" : "") + (marks[k] ? " hit" : "")}><td>{r.source}</td><td>{r.state}</td><td>{r.prefix}</td><td>{HOP_LABEL[r.type]}</td><td>{r.nhIp ?? ""}</td><td>{marks[k] ? `◀ wins for ${marks[k].join(", ")}` : ""}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  vm: "Virtual machine", nva: "Network virtual appliance (forwards traffic)", pe: "Private endpoint", fw: "Azure Firewall",
  dns: "DNS server VM", dnsin: "DNS Private Resolver inbound endpoint", gw: "VPN gateway", bastion: "Azure Bastion", lb: "Internal load balancer frontend",
};
function FwRules({ h }: { h: import("@/sim/types").Host }) {
  const cols = [...(h.fwRules ?? [])].sort((a, b) => a.priority - b.priority);
  if (!cols.length) return <p className="note">No rules. Azure Firewall denies everything that no rule allows.</p>;
  return (
    <div className="table-wrap">
      <table className="mini">
        <thead><tr><th>Priority</th><th>Collection</th><th>Action</th><th>Rule</th><th>Source</th><th>Destination</th><th>Ports</th></tr></thead>
        <tbody>{cols.flatMap((c) => c.rules.map((r) => <tr key={c.name + r.name}><td>{c.priority}</td><td>{c.name}</td><td className={c.action === "Allow" ? "allow" : "deny"}>{c.action}</td><td>{r.name}</td><td>{r.src.join(" ")}</td><td>{r.dst.join(" ")}</td><td>{r.ports.join(" ")}</td></tr>))}</tbody>
      </table>
    </div>
  );
}
/** How to read the table above it. Short, always open, no clicking. */
function Key({ items }: { items: [string, string][] }) {
  return (
    <dl className="read-key">
      {items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}
const NSG_KEY: [string, string][] = [
  ["Priority", "Lower numbers are checked first. The first rule that matches decides, and the rest are skipped."],
  ["*", "Any: any protocol, any port, or any address."],
  ["Source", "Who sends the traffic. VirtualNetwork is your network plus networks peered with it. AzureLoadBalancer is Azure's health probes. Internet is public addresses."],
  ["Port", "The port the traffic is going to on this side, like 443 for HTTPS or 22 for SSH."],
  ["Grey rows", "Azure's default rules, numbered 65000 and up. You can't delete them, but any rule of yours with a lower number comes first."],
];
const ROUTE_KEY: [string, string][] = [
  ["Prefix", "The address range a route covers. When several match, the longest prefix (the most specific) wins."],
  ["Source", "Default is a route Azure adds for you. User is a route from a route table you attached."],
  ["State", "Invalid means Azure ignores it, usually because a user route with the same prefix replaced it."],
  ["Next hop", "Where matching traffic goes. VirtualAppliance sends it to the IP shown, VNet stays in the network, None drops it."],
];
const RT_KEY: [string, string][] = [
  ["Prefix", "The address range this route is for. It only wins if it's the most specific match for the destination."],
  ["Next hop", "Where matching traffic goes. VirtualAppliance sends it to the IP shown. None drops it."],
  ["Applies to", "Only subnets this route table is attached to."],
];
const FW_KEY: [string, string][] = [
  ["Priority", "Collections are checked lowest number first, and the first matching rule decides."],
  ["*", "Any address or any port."],
  ["No match", "Azure Firewall denies traffic that no rule allows."],
];
const Row = ({ k, v }: { k: string; v: string }) => <div className="kv"><span>{k}</span><b>{v}</b></div>;

function What({ kind, open = false }: { kind: ExplainKind; open?: boolean }) {
  const e = EXPLAIN[kind];
  return (
    <details className="what" open={open}>
      <summary>What is this? {e.name}</summary>
      <p>{e.what}</p>
      <p><b>Why it matters here:</b> {e.why}</p>
      <div className="links">{e.learn.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">{l.title}</a>)}</div>
    </details>
  );
}

const tag = (f: FlowResult) => `:${f.flow.port}`;

/** Which inbound rule decides each goal flow arriving at this host, per NSG. */
/** After you tap Explain on a connection: which of your rules it skipped in this NSG, and why. */
function ruleSkips(st: State, nsg: string, flows: FlowResult[]) {
  const m: Record<string, string[]> = {};
  flows.forEach((f) => {
    const t = f.target ? st.hosts[f.target] : null;
    const src = st.hosts[f.flow.from];
    if (!t || !src) return;
    const sn = st.vnets[t.vnet].subnets[t.subnet].nsg;
    if (sn !== nsg && t.nicNsg !== nsg) return;
    const v = evalNsg(st, nsg, "Inbound", { src: src.ip, dst: t.ip, port: f.flow.port, proto: "Tcp" }, t.vnet);
    v.skipped?.forEach((s) => (m[s.rule] ??= []).push(`${s.why} for ${f.flow.from}${tag(f)}`));
  });
  return m;
}

function ruleMarks(st: State, nsg: string, host: string, flows: FlowResult[], prior: string | null = null) {
  const h = st.hosts[host];
  const m: Record<string, string[]> = {};
  flows.filter((f) => f.target === host).forEach((f) => {
    const src = st.hosts[f.flow.from];
    const pkt = { src: src.ip, dst: h.ip, port: f.flow.port, proto: "Tcp" };
    if (prior && evalNsg(st, prior, "Inbound", pkt, h.vnet).access === "Deny") return; // never reaches this NSG
    const v = evalNsg(st, nsg, "Inbound", pkt, h.vnet);
    (m[v.rule] ??= []).push(tag(f));
  });
  return m;
}

export function Inspector({ st, sel, onClose, flows = [], explained = [], actions = null }: { st: State; sel: Selection; onClose: () => void; flows?: FlowResult[]; explained?: FlowResult[]; actions?: React.ReactNode }) {
  let title = "", body: React.ReactNode = null, kind: ExplainKind | null = null;
  if (sel.kind === "host" && st.hosts[sel.id]) {
    const h = st.hosts[sel.id];
    const sn = st.vnets[h.vnet].subnets[h.subnet];
    title = h.name;
    kind = h.kind;
    const routeMarks: Record<number, string[]> = {};
    const eff = effectiveRoutes(st, h.vnet, h.subnet);
    flows.filter((f) => f.flow.from === h.name && f.targetIp).forEach((f) => {
      const best = lookup(eff, ip2n(f.targetIp!)!);
      if (best) (routeMarks[eff.indexOf(best)] ??= []).push(`${f.target ?? f.targetIp}${tag(f)}`);
    });
    body = (
      <>
        <Row k="Type" v={KIND_LABEL[h.kind]} />
        {(h.kind === "nva" || h.kind === "fw") && <Row k="IP forwarding" v={h.forwarding ? "Enabled" : "Disabled"} />}
        {h.kind === "fw" && <><div className="label" style={{ marginTop: 10 }}>Network rule collections, by priority</div><FwRules h={h} /><Key items={FW_KEY} /></>}
        {h.kind === "dns" && <><Row k="Conditional forwarders" v={Object.entries(h.dnsForwarders ?? {}).map(([z, ip]) => `${z} → ${ip}`).join(", ") || "none"} /><Row k="Everything else" v={h.dnsDefault === "azure" ? "Azure DNS (168.63.129.16)" : "public internet recursion"} /></>}
        <Row k="NIC" v={h.nic} />
        <Row k="Private IP" v={h.ip} />
        <Row k="Subnet" v={`${h.vnet} / ${h.subnet}`} />
        <Row k="Subnet NSG" v={sn.nsg ?? "none"} />
        <Row k="NIC NSG" v={h.nicNsg ?? "none"} />
        {h.kind !== "pe" && (h.services || h.guestFw ? <Row k="Inside the VM" v="Azure can't see the guest OS. Use Run command or ssh: ss -tlnp, systemctl status, ufw status." /> : <Row k="Listening on" v={h.ports.join(", ")} />)}
        {(sn.nsg || h.nicNsg) && <div className="label" style={{ marginTop: 10 }}>Inbound rules, in the order Azure checks them</div>}
        {sn.nsg && <><p className="note">1. Subnet NSG {sn.nsg}</p><Rules st={st} nsg={sn.nsg} dir="Inbound" marks={ruleMarks(st, sn.nsg, h.name, flows)} skips={ruleSkips(st, sn.nsg, explained)} /></>}
        {h.nicNsg && <><p className="note">{sn.nsg ? "2." : "1."} NIC NSG {h.nicNsg}</p><Rules st={st} nsg={h.nicNsg} dir="Inbound" marks={ruleMarks(st, h.nicNsg, h.name, flows, sn.nsg)} skips={ruleSkips(st, h.nicNsg, explained)} /></>}
        {(sn.nsg || h.nicNsg) && <p className="note">Rows marked ◀ are the rules that decide this level's goal connections.</p>}
        {(sn.nsg || h.nicNsg) && <Key items={NSG_KEY} />}
        <div className="label" style={{ marginTop: 10 }}>Effective routes</div>
        <Routes st={st} vnet={h.vnet} subnet={h.subnet} marks={routeMarks} />
        <Key items={ROUTE_KEY} />
      </>
    );
  } else if (sel.kind === "subnet" && st.vnets[sel.vnet]?.subnets[sel.subnet]) {
    const s = st.vnets[sel.vnet].subnets[sel.subnet];
    const c = cidr(s.prefixes[0])!;
    title = sel.subnet;
    kind = "subnet";
    body = (
      <>
        <Row k="Range" v={s.prefixes.join(", ")} />
        <Row k="Addresses" v={`${c.size.toLocaleString("en-US")} (${usable(c).toLocaleString("en-US")} usable)`} />
        <Row k="First assignable" v={n2ip(c.net + 4)} />
        <Row k="Last address" v={lastAddr(c)} />
        <Row k="NSG" v={s.nsg ?? "none"} />
        <Row k="Route table" v={s.rt ?? "none"} />
        {s.nsg && <><div className="label" style={{ marginTop: 10 }}>{s.nsg} inbound</div><Rules st={st} nsg={s.nsg} dir="Inbound" skips={ruleSkips(st, s.nsg, explained)} /><Key items={NSG_KEY} /><What kind="nsg" open={false} /></>}
        {s.rt && st.rts[s.rt] && (
          <>
            <div className="label" style={{ marginTop: 10 }}>{s.rt} routes</div>
            <div className="table-wrap"><table className="mini"><thead><tr><th>Name</th><th>Prefix</th><th>Next hop</th><th>IP</th></tr></thead>
              <tbody>{st.rts[s.rt].routes.map((r) => <tr key={r.name}><td>{r.name}</td><td>{r.prefix}</td><td>{r.type}</td><td>{r.nhIp ?? ""}</td></tr>)}</tbody></table></div>
            <Key items={RT_KEY} />
            <What kind="udr" open={false} />
          </>
        )}
      </>
    );
  } else if (sel.kind === "vnet" && st.vnets[sel.id]) {
    const v = st.vnets[sel.id];
    title = sel.id;
    kind = "vnet";
    body = (
      <>
        <Row k="Address space" v={v.prefixes.join(", ")} />
        <Row k="Subnets" v={Object.keys(v.subnets).join(", ") || "none"} />
        <Row k="Peerings" v={peeringsOf(st, sel.id).map((p) => `${p.name} → ${p.remote} (${peeringState(st, p)})`).join(", ") || "none"} />
      </>
    );
  } else if (sel.kind === "peer") {
    title = `${sel.a} ⇄ ${sel.b}`;
    kind = "peer";
    body = (
      <>
        {[[sel.a, sel.b], [sel.b, sel.a]].map(([x, y]) => {
          const l = findLink(st, x, y);
          return (
            <div key={x} style={{ marginBottom: 8 }}>
              <div className="label">Link on {x}</div>
              {l ? <>
                <Row k="Name" v={l.name} />
                <Row k="State" v={peeringState(st, l)} />
                <Row k="Allow VNet access" v={String(l.allowVnetAccess)} />
                <Row k="Allow forwarded traffic" v={String(l.allowForwarded)} />
              </> : <p className="note">No link from {x} to {y} yet. Both sides need one before the peering is Connected.</p>}
            </div>
          );
        })}
      </>
    );
  } else if (sel.kind === "zone" && st.zones[sel.id]) {
    const z = st.zones[sel.id];
    title = sel.id;
    kind = "zone";
    body = (
      <>
        <div className="label">Records</div>
        {Object.entries(z.records).map(([n, ip]) => <Row key={n} k={`${n}.${sel.id}`} v={ip} />)}
        <div className="label" style={{ marginTop: 10 }}>Linked virtual networks</div>
        {Object.entries(z.links).map(([n, l]) => <Row key={n} k={n} v={`${l.vnet}, auto-registration ${l.reg ? "on" : "off"}`} />)}
        <p className="note">Only linked virtual networks can resolve names in this zone.</p>
      </>
    );
  } else return null;

  return (
    <div className="inspector" aria-live="polite">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>{title}</b>
        <button className="btn ghost" type="button" onClick={onClose} style={{ padding: "4px 10px" }}>Close</button>
      </div>
      {actions && <div className="inspect-actions"><div className="label" style={{ margin: 0 }}>Change it</div>{actions}</div>}
      {kind && <What kind={kind} />}
      {body}
    </div>
  );
}
