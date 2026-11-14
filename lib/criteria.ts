import fs from "node:fs";
import path from "node:path";

/**
 * 기준표(criteria) 스키마와 로더.
 * AI 호출 없음 — data/criteria/*.json을 읽고 검증만 한다.
 */

export type CriteriaType = "work" | "rent" | "common";
export type Severity = "high" | "medium" | "low";

export interface CriteriaBasis {
  law: string;
  article: string;
  verified: boolean;
}

export interface CriteriaItem {
  id: string;
  type: CriteriaType;
  title: string;
  question: string;
  risk_signals: string[];
  basis: CriteriaBasis;
  severity_default: Severity;
  user_question: string;
}

const ID_PREFIX: Record<CriteriaType, string> = {
  work: "W-",
  rent: "R-",
  common: "C-",
};

const VALID_TYPES: readonly CriteriaType[] = ["work", "rent", "common"];
const VALID_SEVERITIES: readonly Severity[] = ["high", "medium", "low"];

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function criteriaError(type: CriteriaType, id: string | undefined, message: string): Error {
  const label = id ?? "(알 수 없는 id)";
  return new Error(`[criteria:${type}] ${label}: ${message}`);
}

function validateBasis(
  type: CriteriaType,
  id: string | undefined,
  raw: unknown
): CriteriaBasis {
  if (typeof raw !== "object" || raw === null) {
    throw criteriaError(type, id, "basis가 없거나 객체가 아닙니다");
  }

  const basis = raw as Record<string, unknown>;

  if (!isString(basis.law)) {
    throw criteriaError(type, id, "basis.law가 없거나 문자열이 아닙니다");
  }
  if (!isString(basis.article)) {
    throw criteriaError(type, id, "basis.article이 없거나 문자열이 아닙니다");
  }
  if (!isBoolean(basis.verified)) {
    throw criteriaError(type, id, "basis.verified가 없거나 boolean이 아닙니다");
  }

  return { law: basis.law, article: basis.article, verified: basis.verified };
}

function validateItem(
  type: CriteriaType,
  raw: unknown,
  seenIds: Set<string>
): CriteriaItem {
  if (typeof raw !== "object" || raw === null) {
    throw criteriaError(type, undefined, "항목이 객체가 아닙니다");
  }

  const item = raw as Record<string, unknown>;
  const id = isString(item.id) ? item.id : undefined;

  if (!isString(item.id)) {
    throw criteriaError(type, id, "id가 없거나 문자열이 아닙니다");
  }
  if (item.type !== type) {
    throw criteriaError(type, id, `type이 "${type}"이어야 하는데 "${String(item.type)}"입니다`);
  }
  if (!isString(item.title)) {
    throw criteriaError(type, id, "title이 없거나 문자열이 아닙니다");
  }
  if (!isString(item.question)) {
    throw criteriaError(type, id, "question이 없거나 문자열이 아닙니다");
  }
  if (!isStringArray(item.risk_signals)) {
    throw criteriaError(type, id, "risk_signals가 없거나 string[]이 아닙니다");
  }
  if (
    !isString(item.severity_default) ||
    !VALID_SEVERITIES.includes(item.severity_default as Severity)
  ) {
    throw criteriaError(
      type,
      id,
      `severity_default가 없거나 유효하지 않습니다 (${VALID_SEVERITIES.join("/")} 중 하나)`
    );
  }
  if (!isString(item.user_question)) {
    throw criteriaError(type, id, "user_question이 없거나 문자열이 아닙니다");
  }

  const expectedPrefix = ID_PREFIX[type];
  if (!item.id.startsWith(expectedPrefix)) {
    throw criteriaError(type, id, `id는 "${expectedPrefix}" 접두어로 시작해야 합니다`);
  }

  if (seenIds.has(item.id)) {
    throw criteriaError(type, id, "id가 중복되었습니다");
  }
  seenIds.add(item.id);

  const basis = validateBasis(type, id, item.basis);

  return {
    id: item.id,
    type,
    title: item.title as string,
    question: item.question as string,
    risk_signals: item.risk_signals as string[],
    basis,
    severity_default: item.severity_default as Severity,
    user_question: item.user_question as string,
  };
}

export function loadCriteria(type: CriteriaType): CriteriaItem[] {
  if (!VALID_TYPES.includes(type)) {
    throw new Error(`[criteria] 알 수 없는 type "${type}"`);
  }

  const filePath = path.join(process.cwd(), "data", "criteria", `${type}.json`);
  const raw = fs.readFileSync(filePath, "utf-8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `[criteria:${type}] ${filePath}의 JSON 형식이 올바르지 않습니다: ${(error as Error).message}`
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`[criteria:${type}] ${filePath}은 배열이어야 합니다`);
  }

  const seenIds = new Set<string>();
  return parsed.map((entry) => validateItem(type, entry, seenIds));
}
