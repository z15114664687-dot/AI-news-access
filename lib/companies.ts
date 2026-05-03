import type { Signal } from "./types";

const companyAliases: Array<{ canonical: string; aliases: string[] }> = [
  {
    canonical: "Google",
    aliases: ["google", "google cloud", "google gemini", "gemini"],
  },
  {
    canonical: "Amazon",
    aliases: ["amazon", "aws", "amazon aws", "amazon web services", "amazon web services (aws)"],
  },
  {
    canonical: "Microsoft",
    aliases: ["microsoft", "microsoft azure", "azure"],
  },
  {
    canonical: "Meta",
    aliases: ["meta", "meta ai", "facebook"],
  },
  {
    canonical: "Alibaba",
    aliases: ["alibaba", "qwen", "通义千问"],
  },
];

export const preferredCompanyOrder = ["OpenAI", "Anthropic", "Google", "Cursor", "Amazon", "Microsoft", "Meta", "xAI", "DeepSeek", "Alibaba"];

export function normalizeCompanyName(value: string) {
  const text = value.trim();
  if (!text) return "";
  const key = text.toLowerCase().replace(/\s+/g, " ");
  const match = companyAliases.find((entry) => entry.aliases.includes(key));
  return match?.canonical || text;
}

export function companiesForSignal(signal: Pick<Signal, "companies" | "entity">) {
  const raw = Array.isArray(signal.companies) && signal.companies.length ? signal.companies : [signal.entity];
  return [...new Set(raw.map(normalizeCompanyName).filter(Boolean))];
}

export function sortCompanies(names: string[]) {
  const unique = [...new Set(names.map(normalizeCompanyName).filter(Boolean))];
  return [
    ...preferredCompanyOrder.filter((name) => unique.includes(name)),
    ...unique.filter((name) => !preferredCompanyOrder.includes(name)).sort((a, b) => a.localeCompare(b)),
  ];
}
