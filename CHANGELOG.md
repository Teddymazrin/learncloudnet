# Changelog

All notable changes to Learn Cloud Net are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.2.1] - 2026-10-31

Phone fixes, and a full audit of every level for accuracy and consistency.

### Fixed

- **Portal on phones:** tapping a resource on the Network tab now offers **Change it in the Portal**, which opens that resource's changes. Before, the Portal stayed hidden on the other tab.
- **Reset** now puts the page back too: every section closes, the page returns to the top, and a message confirms it wherever you're scrolled.
- **Clear my progress** asks you to confirm, then says it's done.
- **Current vs finished steps:** the step you're on is now the accent color and says **You're here**; finished steps are green with a check and **Done**. They used to share a green, so the current step looked finished.
- **Guided step numbers** run 1, 2, 3 instead of skipping.
- **review-beginner** now shows How to work it.
- **Level content**, after a review of all 80 levels against their labs and Microsoft Learn:
  - Stories that didn't match the lab in ghost-next-hop, gateway-transit, review-endpoints-dns and probed-down.
  - Azure facts corrected: how routes are chosen, when Azure Firewall translates source addresses, which Bastion SKUs need a public IP, default outbound access, and what a peering with access off blocks.
  - Text that contradicted what the tools show, in spokes-dont-talk, first-route and several Expert solved cards.
  - Going back to Azure-provided DNS now clears the DNS server list, as in Azure, in the Portal and the solutions.
  - Nine broken section links and six wrong link titles to Microsoft Learn.
  - Clearer questions and hints, a fairer clock on spoke-silence, and typos.

## [0.2.0] - 2026-10-31

A guided learning overhaul. Every level now teaches the troubleshooting method, not just the answer, and the map explains itself. Applies to all 80 levels.

### Added

- **Resources** on every level: everything in the lab, grouped by type and kept live. Tap one to find it on the map.
- **Full walkthrough** with Command steps and Portal steps, from seeing it fail to checking the fix. VM commands switch between Linux and Windows. Portal steps name the exact form and what to fill in.
- **The issue and The fix** on the solved card: what was broken when the level started, and each change that fixed it in plain words. Levels where you build something show What you built.
- **Hint context**: the layer each hint checks, why that layer matters, what to look for, and what the check returns in your lab right now.
- **Storage accounts on the map**, with the Private Link to their private endpoint, and requests that reach the public IP drawn going there.

### Changed

- **How to work it** is now a list of action items. Each step says what to do, why it matters, what to look for, and which tools to use. Hiding help keeps what to do and drops the rest.
- **Map key** is a labeled button and only explains the lines on the current map.
- The path of your last test has its own look and is no longer drawn on top of a goal line.
- The Private Link line is green in every theme.

### Fixed

- The guide no longer flips between `exit` and `ssh` as you move between a VM and Cloud Shell.
- On Windows VMs, Linux commands such as `nc` and `ufw` now fail as errors and say the VM runs Windows. `nslookup` prints `nslookup.exe` output, and `curl -sI` gives PowerShell's real error.
- Hints that mention a command in passing no longer offer a Type it button that types a sentence.
- "What's this?" described `az network private-dns link vnet create` as creating a virtual network.
- Quiz answers no longer appear in the list of fix steps.

## [0.1.0]

First public version: 80 levels in four tiers, a sandbox, a cheat sheet, Linux and Windows VMs, and progress saved in the browser.

[0.2.1]: https://github.com/Teddymazrin/learncloudnet/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Teddymazrin/learncloudnet/compare/8053100...v0.2.0
[0.1.0]: https://github.com/Teddymazrin/learncloudnet/commit/8053100
