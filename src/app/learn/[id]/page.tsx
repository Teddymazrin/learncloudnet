import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LEVELS, getLevel } from "@/content";
import { LevelGate } from "@/components/LevelGate";

export const dynamicParams = false;
export function generateStaticParams() { return LEVELS.map((l) => ({ id: l.id })); }

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const l = getLevel(id);
  return l ? { title: l.title, description: l.story } : {};
}

export default async function LevelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getLevel(id)) notFound();
  return <LevelGate id={id} />;
}
