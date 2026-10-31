// Shapes of the simulated Azure network. Everything lives in one resource group.

export type Direction = "Inbound" | "Outbound";
export type Access = "Allow" | "Deny";
export type HopType = "VnetLocal" | "VNetPeering" | "Internet" | "None" | "VirtualAppliance" | "VirtualNetworkGateway" | "VirtualNetworkServiceEndpoint";

export interface Subnet {
  prefixes: string[];
  nsg: string | null;
  rt: string | null;
  /** Service endpoints enabled on the subnet, like Microsoft.Storage. */
  serviceEndpoints?: string[];
  /** false makes it a private subnet: no default outbound access to the internet. */
  defaultOutbound?: boolean;
  /** NAT gateway associated with the subnet. */
  natGateway?: string | null;
}

export interface VNet {
  prefixes: string[];
  subnets: Record<string, Subnet>;
  /** An on-premises network reached through a VPN gateway, drawn like a VNet but not peerable. */
  onprem?: boolean;
  /** Custom DNS servers. Empty or missing means Azure-provided DNS (168.63.129.16). */
  dnsServers?: string[];
  /** Resource group, when the lab has more than one. Missing means rg-lab. */
  rg?: string;
}

export interface NsgRule {
  name: string;
  priority: number;
  direction: Direction;
  access: Access;
  protocol: string;
  src: string[];
  dst: string[];
  ports: string[];
  description?: string;
  def?: boolean;
}

export interface Nsg {
  rules: NsgRule[];
  rg?: string;
}

export interface Route {
  name: string;
  prefix: string;
  type: HopType;
  nhIp?: string;
}

export interface RouteTable {
  routes: Route[];
  rg?: string;
}

export interface Peering {
  name: string;
  vnet: string;
  remote: string;
  allowVnetAccess: boolean;
  allowForwarded: boolean;
  allowGatewayTransit?: boolean;
  useRemoteGateways?: boolean;
  /** The remote address space this link last synced. Missing means always current. */
  remotePrefixes?: string[];
}

export type HostKind = "vm" | "nva" | "pe" | "fw" | "dns" | "dnsin" | "gw" | "bastion" | "lb";

export interface FwRule { name: string; protocols: string[]; src: string[]; dst: string[]; ports: string[] }
export interface FwCollection { name: string; priority: number; action: "Allow" | "Deny"; rules: FwRule[] }

export interface Host {
  name: string;
  kind: HostKind;
  vnet: string;
  subnet: string;
  ip: string;
  nic: string;
  nicNsg: string | null;
  ports: number[];
  forwarding: boolean;
  label?: string;
  /** Azure Firewall network rule collections (kind fw). */
  fwRules?: FwCollection[];
  /** DNS server VM: conditional forwarders, zone suffix to target IP. */
  dnsForwarders?: Record<string, string>;
  /** DNS server VM: where everything else goes. "public" recursion or "azure" (168.63.129.16). */
  dnsDefault?: "public" | "azure";
  /** DNS server VM: zones it answers for itself, like an on-premises corp zone. */
  dnsZones?: Record<string, Record<string, string>>;
  /** Instance-level public IP on the NIC. */
  publicIp?: string;
  /** The VM's own firewall (UFW on Ubuntu). Inside the guest, so NSG tools never show it. */
  guestFw?: GuestFw;
  /** Services on the VM and the port each listens on while running. A stopped service's port isn't in ports. */
  services?: Record<string, number>;
  rg?: string;
  /** The guest OS, for VMs made in the sandbox. */
  os?: "linux" | "windows";
}

/** UFW: rules in order, first match wins; when active, anything no rule allows is denied. */
export interface GuestFw {
  active: boolean;
  rules: { port: number; from: string; action: "ALLOW" | "DENY" }[];
}

export interface DnsZone {
  records: Record<string, string>;
  links: Record<string, { vnet: string; reg: boolean }>;
}

export interface State {
  vnets: Record<string, VNet>;
  nsgs: Record<string, Nsg>;
  rts: Record<string, RouteTable>;
  peerings: Record<string, Peering>;
  hosts: Record<string, Host>;
  zones: Record<string, DnsZone>;
  publicDns: { cname: Record<string, string>; a: Record<string, string> };
  publicEndpoints: Record<string, PublicService>;
  layout: string[];
  /** VPN gateways by the VNet they sit in, with the on-premises networks they connect. */
  gateways?: Record<string, { name: string; host: string; connections: string[] }>;
  resolvers?: Record<string, Resolver>;
  rulesets?: Record<string, Ruleset>;
  bastions?: Record<string, { vnet: string; sku: string; tunneling: boolean; host: string }>;
  publicIps?: Record<string, { sku: string; ip?: string; region?: string }>;
  natGateways?: Record<string, { pips: string[] }>;
  /** Sites on the public internet, by IP. */
  internet?: Record<string, { name: string }>;
  /** Internal load balancers. The frontend is drawn as a host of kind lb. */
  lbs?: Record<string, LoadBalancer>;
  /** Sandbox only: resource groups and the subscription each belongs to. Missing means the single rg-lab. */
  groups?: Record<string, { sub: string }>;
  /** Sandbox only: subscription names. */
  subscriptions?: string[];
}

export interface LoadBalancer {
  host: string;
  probe: { name: string; protocol: string; port: number };
  rule: { name: string; frontendPort: number; backendPort: number };
  backends: string[];
}

/** A PaaS public endpoint, like a storage account, with its network settings. */
export interface PublicService {
  name: string;
  publicAccess: boolean;
  defaultAction?: "Allow" | "Deny";
  vnetRules?: { vnet: string; subnet: string }[];
}
export interface Resolver { vnet: string; inbound: Record<string, { subnet: string; host: string }>; outbound: Record<string, { subnet: string }> }
export interface Ruleset { resolver: string; rules: Record<string, { domain: string; targets: string[]; enabled: boolean }>; links: Record<string, string> }

export interface TraceResult {
  ok: boolean;
  reason?: string;
  path: string[];
  via: string[];
  stage?: "nsg" | "route" | "peering" | "host" | "port" | "public" | "return" | "firewall" | "probe" | "guest";
  target?: string;
  /** Set when the session ended at a public service endpoint rather than a host. */
  service?: string;
  /** How internet-bound traffic left Azure, for output. */
  egress?: string;
}

/** One executed command, kept so lessons can check "did the learner look at X". */
export interface LogEntry {
  raw: string;
  words: string[];
  flags: Flags;
  ok: boolean;
  inVm: string | null;
  /** The Linux twin of a Windows command, so checks read one form. */
  canon?: string;
}

export type Flags = Record<string, string[]>;

export interface Session {
  vm: string | null;
  /** What the lab VMs run. Linux unless the player picks Windows. */
  os?: "linux" | "windows";
  log: LogEntry[];
  answers: Record<string, string>;
}

export interface RunResult {
  text: string;
  error?: boolean;
  mut?: boolean;
  trace?: TraceResult;
  meta?: "help" | "hint" | "goals" | "reset" | "clear";
}

export const newSession = (os: "linux" | "windows" = "linux"): Session => ({ vm: null, os, log: [], answers: {} });

export const emptyState = (): State => ({
  vnets: {}, nsgs: {}, rts: {}, peerings: {}, hosts: {}, zones: {},
  publicDns: { cname: {}, a: {} }, publicEndpoints: {}, layout: [],
});
