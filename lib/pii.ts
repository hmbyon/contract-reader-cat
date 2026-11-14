// 이름·주소는 패턴으로 안정적으로 잡을 수 없어 이번 범위에서 다루지 않는다.

export interface PIIMatch {
  type: string;
  count: number;
}

interface PIIPattern {
  type: string;
  mask: string;
  pattern: () => RegExp;
}

const PII_PATTERNS: PIIPattern[] = [
  {
    type: "주민번호",
    mask: "[주민번호]",
    pattern: () => /\d{6}-\d{7}/g,
  },
  {
    type: "전화번호",
    mask: "[전화번호]",
    pattern: () => /\b0\d{1,2}-\d{3,4}-\d{4}\b/g,
  },
  {
    type: "이메일",
    mask: "[이메일]",
    pattern: () => /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  },
];

export function detectPII(text: string): PIIMatch[] {
  const results: PIIMatch[] = [];

  for (const { type, pattern } of PII_PATTERNS) {
    const matches = text.match(pattern());
    if (matches && matches.length > 0) {
      results.push({ type, count: matches.length });
    }
  }

  return results;
}

export function maskPII(text: string): string {
  let masked = text;

  for (const { mask, pattern } of PII_PATTERNS) {
    masked = masked.replace(pattern(), mask);
  }

  return masked;
}
