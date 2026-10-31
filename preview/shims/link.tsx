import type { AnchorHTMLAttributes, ReactNode } from "react";
import { toHash } from "./route";
export default function Link({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode }) {
  return <a href={toHash(href)} {...rest}>{children}</a>;
}
