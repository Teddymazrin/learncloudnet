// IPv4 and CIDR math. Pure, no Azure rules here.

export interface Cidr {
  net: number;
  len: number;
  mask: number;
  aligned: boolean;
  text: string;
  size: number;
}

export function ip2n(ip: string): number | null {
  const p = ip.split(".");
  if (p.length !== 4) return null;
  let n = 0;
  for (const part of p) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const v = Number(part);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

export function n2ip(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

export function maskOf(len: number): number {
  return len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0;
}

export function cidr(s: string): Cidr | null {
  const m = String(s).trim().match(/^(\d+\.\d+\.\d+\.\d+)(?:\/(\d{1,2}))?$/);
  if (!m) return null;
  const ip = ip2n(m[1]);
  if (ip === null) return null;
  const len = m[2] === undefined ? 32 : Number(m[2]);
  if (len > 32) return null;
  const mask = maskOf(len);
  const net = (ip & mask) >>> 0;
  return { net, len, mask, aligned: net === ip, text: `${n2ip(net)}/${len}`, size: 2 ** (32 - len) };
}

export function mustCidr(s: string): Cidr {
  const c = cidr(s);
  if (!c) throw new Error(`invalid CIDR ${s}`);
  return c;
}

export const inC = (c: Cidr, ipn: number) => ((ipn & c.mask) >>> 0) === c.net;

export function overlap(a: Cidr, b: Cidr): boolean {
  const m = maskOf(Math.min(a.len, b.len));
  return ((a.net & m) >>> 0) === ((b.net & m) >>> 0);
}

export const within = (inner: Cidr, outer: Cidr) => inner.len >= outer.len && inC(outer, inner.net);

const PRIVATE = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"].map(mustCidr);
export const isPrivate = (ipn: number) => PRIVATE.some((c) => inC(c, ipn));

/** Azure reserves five addresses in every subnet. */
export const AZURE_RESERVED = 5;
export const usable = (c: Cidr) => Math.max(0, c.size - AZURE_RESERVED);
export const lastAddr = (c: Cidr) => n2ip((c.net + c.size - 1) >>> 0);
