const englishTagCategories: Readonly<Record<string, string>> = {
  "主体": "Subject",
  "场景": "Scene",
  "动作": "Action",
  "主题": "Topic",
  "氛围": "Mood",
  "形式": "Format"
};

/** Categories are display labels; stored and exported analysis data stays intact. */
export function translateTagCategory(category: string, language: "en" | "zh"): string {
  return language === "en" && Object.hasOwn(englishTagCategories, category) ? englishTagCategories[category] : category;
}
