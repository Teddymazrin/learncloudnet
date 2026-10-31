import type { Metadata } from "next";
import { LevelPlayer } from "@/components/LevelPlayer";
export const metadata: Metadata = { title: "Sandbox", description: "A free hub-and-spoke Azure networking lab with no goals." };
export default function Sandbox() { return <LevelPlayer id="sandbox" />; }
