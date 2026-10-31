import type { Level } from "@/content/types";

/** Levels about the VM's own firewall, services or Run Command are written for Ubuntu, so their VMs stay Linux. */
export const linuxOnly = (level: Level) =>
  [...level.hints, ...level.solution, ...(level.steps ?? []).map((x) => x.cmd ?? "")].some((c) => /\b(ufw|systemctl|netstat|run-command)\b|(^|\s)ss\s/.test(c));
