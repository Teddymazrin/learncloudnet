import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import "../src/app/globals.css";
import { ProgressProvider } from "@/lib/progress";
import { SiteHeader } from "@/components/SiteHeader";
import { LevelGate } from "@/components/LevelGate";
import { LevelPlayer } from "@/components/LevelPlayer";
import { PathView } from "@/components/PathView";
import { getLevel } from "@/content";
import Home from "../src/app/page";
import Cheatsheet from "../src/app/cheatsheet/page";
import About from "../src/app/about/page";
import { usePathname } from "next/navigation";

function Page() {
  const path = usePathname();
  useEffect(() => { window.scrollTo(0, 0); }, [path]);
  const m = path.match(/^\/learn\/([^/]+)\/$/);
  if (m && getLevel(m[1])) return <LevelGate key={m[1]} id={m[1]} />;
  if (path === "/learn/") return <PathView />;
  if (path === "/sandbox/") return <LevelPlayer id="sandbox" />;
  if (path === "/cheatsheet/") return <Cheatsheet />;
  if (path === "/about/") return <About />;
  return <Home />;
}

function App() {
  return (
    <ProgressProvider>
      <SiteHeader />
      <Page />
      <footer className="site-foot">
        <div className="wrap"><div className="note">
          <span>Next Hop is an independent learning project, not affiliated with or endorsed by Microsoft. It simulates a subset of the Azure CLI. Nothing here touches a real subscription.</span>
          <span>Preview build. Facts are sourced from Microsoft Learn. Each level links its sources.</span>
        </div></div>
      </footer>
    </ProgressProvider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
