#!/usr/bin/env python3
"""Audit built public documents without a browser or third-party dependencies."""
import argparse
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urljoin, urlsplit
from xml.etree import ElementTree

SITE = "https://koma.yuxino.cn"
LANGUAGES = {"en": SITE + "/", "zh-CN": SITE + "/zh/", "x-default": SITE + "/"}
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
FORBIDDEN_SCHEMA = {"rating", "ratings", "aggregaterating", "ratingvalue", "review", "reviews", "offer", "offers", "jobid", "ownerid", "userid", "inputpath", "transcript", "transcriptsegments", "videourl", "sourceurl"}


class Document(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.lang = None
        self.titles = []
        self.headings = []
        self.links = []
        self.metas = []
        self.anchors = []
        self.references = []
        self.jsonld = []
        self.body_text = []
        self.inline_styles = []
        self.stack = []
        self.captures = []
        self.feed(source)
        self.close()

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag not in VOID:
            self.stack.append(tag)
        if tag == "html":
            self.lang = attrs.get("lang")
        if tag == "link":
            self.links.append(attrs)
        if tag == "meta":
            self.metas.append(attrs)
        for attr in ("src", "href", "poster"):
            if attrs.get(attr):
                self.references.append((tag, attr, attrs[attr], attrs))
        if attrs.get("srcset"):
            for candidate in attrs["srcset"].split(","):
                if candidate.strip():
                    self.references.append((tag, "srcset", candidate.strip().split()[0], attrs))
        if tag in {"title", "h1", "a", "style"} or (tag == "script" and attrs.get("type", "").lower() == "application/ld+json"):
            self.captures.append({"tag": tag, "attrs": attrs, "text": []})

    def handle_endtag(self, tag):
        for index in range(len(self.captures) - 1, -1, -1):
            capture = self.captures[index]
            if capture["tag"] == tag:
                self.captures.pop(index)
                text = "".join(capture["text"])
                if tag == "title":
                    self.titles.append(text.strip())
                elif tag == "h1":
                    self.headings.append(" ".join(text.split()))
                elif tag == "a":
                    self.anchors.append({**capture["attrs"], "text": " ".join(text.split())})
                elif tag == "script":
                    self.jsonld.append(text)
                elif tag == "style":
                    self.inline_styles.append(text)
                break
        if tag in self.stack:
            self.stack = self.stack[:len(self.stack) - 1 - self.stack[::-1].index(tag)]

    def handle_data(self, data):
        for capture in self.captures:
            capture["text"].append(data)
        if "body" in self.stack and not any(tag in self.stack for tag in ("script", "style")):
            self.body_text.append(data)

    def meta(self, name):
        return [item.get("content", "") for item in self.metas if (item.get("property") or item.get("name") or "").lower() == name.lower()]

    def rel(self, name):
        return [item for item in self.links if name in item.get("rel", "").lower().split()]


def schema_problem(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if re.sub(r"[^a-z]", "", key.lower()) in FORBIDDEN_SCHEMA:
                return True
            if key == "@type":
                types = [child] if isinstance(child, str) else child if isinstance(child, list) else []
                if any(item in {"Review", "Rating", "AggregateRating", "Offer", "AggregateOffer"} for item in types if isinstance(item, str)):
                    return True
            if schema_problem(child):
                return True
    elif isinstance(value, list):
        return any(schema_problem(child) for child in value)
    elif isinstance(value, str):
        return bool(re.search(r"/(?:jobs|api/(?:my|jobs|admin))(?:/|[?#]|$)", value, re.I))
    return False


def schema_types(value):
    result = set()
    if isinstance(value, dict):
        types = value.get("@type", [])
        if isinstance(types, str):
            result.add(types)
        elif isinstance(types, list):
            result.update(item for item in types if isinstance(item, str))
        for child in value.values():
            result.update(schema_types(child))
    elif isinstance(value, list):
        for child in value:
            result.update(schema_types(child))
    return result


def schema_context(value):
    if isinstance(value, dict):
        context = value.get("@context")
        if isinstance(context, str) and context.rstrip("/") in {"https://schema.org", "http://schema.org"}:
            return True
        return any(schema_context(child) for child in value.values())
    if isinstance(value, list):
        return any(schema_context(child) for child in value)
    return False


def main():
    repo = Path(__file__).resolve().parents[1]
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("dist", nargs="?", type=Path, default=repo / "dist")
    cli.add_argument("--output", type=Path, default=repo / "work/qa/seo-after-build.json")
    args = cli.parse_args()
    dist = args.dist.resolve()
    checks = []
    pages = {}
    asset_paths = set()

    def check(name, passed, detail=None):
        item = {"check": name, "passed": bool(passed)}
        if detail is not None:
            item["detail"] = detail
        checks.append(item)

    def local_path(reference, document_url):
        url = urlsplit(urljoin(document_url, reference))
        if url.scheme not in ("http", "https") or url.netloc != urlsplit(SITE).netloc:
            return None
        path = (dist / unquote(url.path).lstrip("/")).resolve()
        if path != dist and dist not in path.parents:
            return False
        if url.path.endswith("/"):
            path = path / "index.html"
        return path

    def assets(doc, page_url, name):
        missing = []
        checked = set()
        for tag, attr, reference, attrs in doc.references:
            if reference.startswith("#"):
                continue
            path = local_path(reference, page_url)
            if path is None:
                continue
            # Navigational/auth routes are not filesystem assets.
            if tag == "a" and attr == "href" and not Path(urlsplit(reference).path).suffix:
                continue
            if tag == "link" and attrs.get("rel") in {"canonical", "alternate"}:
                continue
            if path is False or not path.is_file():
                missing.append(reference)
            else:
                checked.add(str(path.relative_to(dist)))
                asset_paths.add("/" + str(path.relative_to(dist)))
        check(name + ".local-assets-exist", not missing, {"checked": sorted(checked), "missing": missing})

    for relative, language, canonical in [("index.html", "en", SITE + "/"), ("zh/index.html", "zh-CN", SITE + "/zh/")]:
        file = dist / relative
        check(relative + ".exists", file.is_file())
        if not file.is_file():
            continue
        doc = Document(file.read_text(encoding="utf-8"))
        pages[relative] = {"lang": doc.lang, "h1Count": len(doc.headings), "titleCount": len(doc.titles), "bodyTextCharacters": len(" ".join("".join(doc.body_text).split()))}
        check(relative + ".lang", doc.lang == language)
        check(relative + ".one-title", len(doc.titles) == 1 and bool(doc.titles[0]))
        check(relative + ".one-h1", len(doc.headings) == 1 and bool(doc.headings[0]))
        check(relative + ".canonical", [link.get("href") for link in doc.rel("canonical")] == [canonical])
        alternatives = doc.rel("alternate")
        actual = [(link.get("hreflang"), link.get("href")) for link in alternatives if link.get("hreflang")]
        check(relative + ".reciprocal-hreflang", len(actual) == 3 and dict(actual) == LANGUAGES)
        other = "zh-CN" if language == "en" else "en"
        labels = {"en": {"english", "en"}, "zh-CN": {"简体中文", "中文", "zh", "zh-cn"}}
        language_links = [link for link in doc.anchors if urljoin(canonical, link.get("href", "")) == LANGUAGES[other] and (link.get("hreflang") == other or link["text"].lower() in labels[other])]
        check(relative + ".real-language-anchor", bool(language_links))
        check(relative + ".indexable-meta", not any("noindex" in value.lower() for value in doc.meta("robots") + doc.meta("googlebot")))
        images = doc.meta("og:image")
        image = urlsplit(images[0]) if len(images) == 1 else None
        valid_image = bool(image and image.scheme == "https" and image.netloc == urlsplit(SITE).netloc and image.path.lower().endswith(".png") and not image.query and not image.fragment)
        check(relative + ".absolute-og-png", valid_image)
        check(relative + ".og-image-alt", len(doc.meta("og:image:alt")) == 1 and bool(doc.meta("og:image:alt")[0].strip()))
        if valid_image:
            path = local_path(images[0], canonical)
            data = path.read_bytes() if path and path.is_file() else b""
            dimensions = [int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")] if data.startswith(b"\x89PNG\r\n\x1a\n") and data[12:16] == b"IHDR" else []
            check(relative + ".og-image-512", dimensions == [512, 512], dimensions)
            if path and path.is_file():
                asset_paths.add("/" + str(path.relative_to(dist)))
        for property_name in ("og:image:width", "og:image:height"):
            if doc.meta(property_name):
                check(relative + "." + property_name, doc.meta(property_name) == ["512"])
        parsed_schema = []
        for raw in doc.jsonld:
            try:
                value = json.loads(raw)
                if not isinstance(value, (dict, list)):
                    raise ValueError("JSON-LD must be an object or array")
                parsed_schema.append(value)
            except (ValueError, TypeError):
                check(relative + ".jsonld-parse", False)
        check(relative + ".jsonld-present-valid", bool(doc.jsonld) and len(parsed_schema) == len(doc.jsonld) and any(schema_types(value) for value in parsed_schema))
        check(relative + ".schema-org-context", bool(parsed_schema) and all(schema_context(value) for value in parsed_schema))
        check(relative + ".no-unproven-schema-or-private-task-fields", not any(schema_problem(value) for value in parsed_schema))
        pages[relative]["schemaTypes"] = sorted(set().union(*(schema_types(value) for value in parsed_schema)))
        assets(doc, canonical, relative)
        stylesheet_bytes = 0
        for link in doc.rel("stylesheet"):
            path = local_path(link.get("href", ""), canonical)
            if path and path.is_file():
                stylesheet_bytes += path.stat().st_size
        check(relative + ".initial-html-stylesheets", stylesheet_bytes > 0, {"linkedCssBytes": stylesheet_bytes, "inlineCssBytes": sum(len(value.encode("utf-8")) for value in doc.inline_styles)})

    private_file = dist / "app.html"
    check("app.html.exists", private_file.is_file())
    if private_file.is_file():
        doc = Document(private_file.read_text(encoding="utf-8"))
        check("app.html.noindex", any("noindex" in value.lower() for value in doc.meta("robots")))
        check("app.html.no-canonical", not doc.rel("canonical"))
        check("app.html.no-jsonld", not doc.jsonld)
        assets(doc, SITE + "/app.html", "app.html")

    sitemap = dist / "sitemap.xml"
    try:
        tree = ElementTree.parse(sitemap)
        urls = [node.text for node in tree.findall("{http://www.sitemaps.org/schemas/sitemap/0.9}url/{http://www.sitemaps.org/schemas/sitemap/0.9}loc")]
        check("sitemap.only-two-public-urls", tree.getroot().tag == "{http://www.sitemaps.org/schemas/sitemap/0.9}urlset" and len(urls) == 2 and set(urls) == {SITE + "/", SITE + "/zh/"}, urls)
    except (OSError, ElementTree.ParseError):
        check("sitemap.valid-xml", False)

    robots = dist / "robots.txt"
    try:
        text = robots.read_text(encoding="utf-8")
        check("robots.plain-text", not re.search(r"<!doctype|<html|<body", text, re.I))
        groups = []
        agents, rules, sitemaps = [], [], []
        for raw in text.splitlines():
            line = raw.split("#", 1)[0].strip()
            if ":" not in line:
                continue
            name, value = (part.strip() for part in line.split(":", 1))
            name = name.lower()
            if name == "user-agent":
                if rules:
                    groups.append((agents, rules)); agents, rules = [], []
                agents.append(value.lower())
            elif name in {"allow", "disallow"} and agents:
                rules.append((name, value))
            elif name == "sitemap":
                sitemaps.append(value)
        if agents:
            groups.append((agents, rules))
        check("robots.generic-user-agent", any("*" in agents for agents, _rules in groups))
        check("robots.sitemap-reference", SITE + "/sitemap.xml" in sitemaps)
        blocked = []
        for agents, rules in groups:
            for path in sorted({"/", "/zh/", "/assets/"} | asset_paths):
                matches = []
                for name, pattern in rules:
                    if not pattern:
                        continue
                    ending = "$" if pattern.endswith("$") else ""
                    regex = "^" + re.escape(pattern.rstrip("$")).replace(r"\*", ".*") + ending
                    if re.match(regex, path):
                        matches.append((len(pattern.replace("*", "").rstrip("$")), name == "allow"))
                if matches and not max(matches)[1]:
                    blocked.append({"agents": agents, "path": path})
        check("robots.public-and-assets-crawlable", not blocked, blocked)
    except OSError:
        check("robots.exists", False)

    failed = [check for check in checks if not check["passed"]]
    report = {"checkedAt": datetime.now(timezone.utc).isoformat(), "dist": str(dist), "passed": not failed, "checksPassed": len(checks) - len(failed), "checksTotal": len(checks), "pages": pages, "checks": checks, "limits": ["Static artifact checks only; no search-engine indexing or ranking claim.", "Stylesheet linkage is checked; visual no-JavaScript layout and HTTP headers need separate browser/HTTP verification.", "Private-data detection checks known schema fields and private route references; it cannot establish arbitrary content provenance."]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "checksPassed": report["checksPassed"], "checksTotal": len(checks), "failed": [item["check"] for item in failed], "report": str(args.output)}, ensure_ascii=False))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
