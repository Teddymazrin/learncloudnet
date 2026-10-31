import type { Metadata } from "next";
import { PathView } from "@/components/PathView";
export const metadata: Metadata = { title: "Learning path" };
export default function Learn() { return <PathView />; }
