import { useEffect, useState } from "react";
import { GITHUB_STAR_SNAPSHOT, refreshGithubStars } from "../../shared/github-stars.js";
import { GithubMark } from "./WelcomeScreen.js";

export function GithubStarLink({ language }: { language: "zh" | "en" }) {
  // The first render also works without a browser and always has a verified count.
  const [snapshot, setSnapshot] = useState(GITHUB_STAR_SNAPSHOT);
  useEffect(() => {
    const controller = new AbortController();
    void refreshGithubStars({ signal: controller.signal }).then(next => {
      if (!controller.signal.aborted) setSnapshot(next);
    });
    return () => controller.abort();
  }, []);

  const locale = language === "zh" ? "zh-CN" : "en-US";
  const count = snapshot.count.toLocaleString(locale);
  const displayCount = snapshot.count < 1000 ? count : new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(snapshot.count);
  const stars = snapshot.count === 1 ? "star" : "stars";
  const label = language === "zh" ? `在 GitHub 上为 Koma 点 Star，${count} 个 Star` : `Star Koma on GitHub, ${count} ${stars}`;
  const checked = new Date(snapshot.checkedAt).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  const title = language === "zh" ? `${count} 个 GitHub Star · 最近核对：${checked}` : `${count} GitHub ${stars} · Checked ${checked}`;
  return <a className="github-star" href="https://github.com/yuxino/koma" target="_blank" rel="noreferrer" aria-label={label} title={title}>
    <span className="github-star-label"><GithubMark /><span>Star</span></span>
    <span className="github-star-count" aria-hidden="true">{displayCount}</span>
  </a>;
}
