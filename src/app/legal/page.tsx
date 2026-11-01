import type { Metadata } from "next";
export const metadata: Metadata = { title: "Legal notice", description: "Who runs Learn Cloud Net, supporting the project, trademarks, no affiliation with Microsoft, no warranty, and privacy." };

const REPO = "https://github.com/Teddymazrin/learncloudnet";
const SPONSOR = "https://github.com/sponsors/Teddymazrin";

export default function Legal() {
  return (
    <div className="wrap prose">
      <h1>Legal notice</h1>
      <p className="muted">Last updated November 1, 2026.</p>

      <h2>Who runs this site</h2>
      <p>Learn Cloud Net (learncloudnet.com) is a free, independent learning project made by Teddy Mazrin. It isn't a company and doesn&apos;t sell anything. For questions or problems, open an issue on <a href={`${REPO}/issues`} target="_blank" rel="noopener noreferrer">GitHub</a>.</p>

      <h2>Supporting the project</h2>
      <p>Learn Cloud Net is free, and every level stays free. If it helps you, you can support it through <a href={SPONSOR} target="_blank" rel="noopener noreferrer">GitHub Sponsors</a>. Support is optional and goes to Teddy Mazrin personally. It isn&apos;t a purchase, doesn&apos;t unlock anything, and isn&apos;t a charitable donation, so it isn&apos;t tax-deductible. Microsoft doesn&apos;t receive or endorse it. GitHub&apos;s own terms and privacy policy apply to payments made there.</p>

      <h2>Not affiliated with Microsoft</h2>
      <p>Learn Cloud Net is not affiliated with, sponsored by, endorsed by or connected to Microsoft Corporation in any way. It isn&apos;t an official Microsoft product, training or certification resource, and nothing here is a statement by Microsoft.</p>

      <h2>Trademarks and ownership</h2>
      <p>Learn Cloud Net doesn&apos;t own Microsoft, Azure, or any other company&apos;s names, products, services or documentation. Microsoft, Azure, Azure CLI, Windows and PowerShell are trademarks of the Microsoft group of companies. GitHub is a trademark of GitHub, Inc. Ubuntu is a trademark of Canonical Ltd. All other names and trademarks belong to their owners. They are used here only to describe what the site teaches, and their use doesn&apos;t imply any affiliation or endorsement.</p>
      <p>Links to Microsoft Learn and other sites go to content owned by those sites. Learn Cloud Net links to it as a source and doesn&apos;t copy or claim it.</p>

      <h2>Educational use only, no warranty</h2>
      <p>Everything here is provided for learning, as is, without warranty of any kind, express or implied. The site is a simulator: it models a subset of the Azure CLI and Azure networking behavior, and it simplifies some things on purpose. It can be incomplete, out of date or wrong. It isn&apos;t professional, legal or security advice.</p>
      <p>Before you change a real environment, check the current Microsoft documentation and your organization&apos;s policies. Nothing on this site connects to a real Azure subscription, and you use what you learn here at your own risk. To the extent the law allows, the author isn&apos;t liable for any loss or damage that comes from using this site.</p>

      <h2>Privacy</h2>
      <p>There are no accounts, no ads, no analytics and no tracking cookies. Your progress and settings (stars, XP, theme, layout and similar) are saved only in your own browser&apos;s local storage. They never leave your device, and you can clear them any time from the learning path page or your browser settings.</p>
      <p>Two services see basic request data, such as your IP address, when you load the site: GitHub Pages, which hosts it, and Google Fonts, which serves its fonts. Their own privacy policies apply to that data.</p>

      <h2>Source code and license</h2>
      <p>The site&apos;s source code is on <a href={REPO} target="_blank" rel="noopener noreferrer">GitHub</a> under the MIT License. That license covers the code written for this project, not the third-party names, trademarks or linked documentation above.</p>

      <h2>Changes</h2>
      <p>This notice can change as the site changes. The date at the top shows the latest version.</p>
    </div>
  );
}
