import { describe, expect, it } from "vitest";
import { pageMetadata, publicLanguage, publicPath } from "./public-site.js";

describe("public product metadata", () => {
  it("only recognizes the two canonical public language paths", () => {
    expect(publicLanguage("/")).toBe("en");
    expect(publicLanguage("/zh/")).toBe("zh");
    for (const path of ["/jobs/01234567-89ab-cdef-0123-456789abcdef", "/admin", "/api/my/jobs", "/missing"]) expect(publicLanguage(path)).toBeUndefined();
    expect(publicPath("en")).toBe("/");
    expect(publicPath("zh")).toBe("/zh/");
  });

  it.each(["en", "zh"] as const)("keeps %s schema factual and locale links reciprocal", language => {
    const head = pageMetadata(language);
    expect(head.match(/rel="canonical"/g)).toHaveLength(1);
    expect(head).toContain(`rel="canonical" href="https://koma.yuxino.cn${publicPath(language)}"`);
    for (const [locale, path] of [["en", "/"], ["zh-CN", "/zh/"], ["x-default", "/"]]) expect(head).toContain(`hreflang="${locale}" href="https://koma.yuxino.cn${path}"`);
    const schema = JSON.parse(head.match(/type="application\/ld\+json">(.*?)<\/script>/s)![1]);
    expect(schema["@graph"].map((entity: { "@type": string }) => entity["@type"])).toEqual(["WebSite", "SoftwareApplication", "WebPage"]);
    expect(schema["@graph"][2].inLanguage).toBe(language === "zh" ? "zh-CN" : "en");
    for (const invented of ["aggregateRating", "review", "offers", "FAQPage", "downloadUrl", "/jobs/"]) expect(head).not.toContain(invented);
  });

  it("uses noindex and omits product schema and canonical on private application views", () => {
    const head = pageMetadata("zh", false);
    expect(head).toContain('name="robots" content="noindex, nofollow, noarchive"');
    expect(head).not.toContain("canonical");
    expect(head).not.toContain("application/ld+json");
    expect(head).not.toContain("hreflang");
  });
});
