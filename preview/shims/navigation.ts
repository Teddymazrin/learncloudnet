import { useSyncExternalStore } from "react";
import { currentPath, subscribe, toHash } from "./route";
export function usePathname() { return useSyncExternalStore(subscribe, currentPath, () => "/"); }
export function useRouter() { return { push: (href: string) => { location.hash = toHash(href); } }; }
export function notFound(): never { throw new Error("not found"); }
