export interface Clause {
  no: string;
  title: string;
  body: string;
}

const CLAUSE_HEADER = /^(제\d+조)\(([^)]*)\)\s*(.*)$/;

interface OpenClause {
  no: string;
  title: string;
  bodyLines: string[];
}

function closeClause(open: OpenClause): Clause {
  return {
    no: open.no,
    title: open.title,
    body: open.bodyLines.join("\n").trim(),
  };
}

function splitParagraphs(text: string): Clause[] {
  const paragraphs = text
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  return paragraphs.map((body, index) => ({
    no: `문단${index + 1}`,
    title: "",
    body,
  }));
}

export function splitClauses(text: string): Clause[] {
  const lines = text.split(/\r?\n/);

  const preambleLines: string[] = [];
  const clauses: Clause[] = [];
  let current: OpenClause | null = null;

  for (const line of lines) {
    const match = line.match(CLAUSE_HEADER);

    if (match) {
      if (current) {
        clauses.push(closeClause(current));
      }
      current = { no: match[1], title: match[2], bodyLines: [match[3]] };
    } else if (current) {
      current.bodyLines.push(line);
    } else {
      preambleLines.push(line);
    }
  }

  if (current) {
    clauses.push(closeClause(current));
  }

  if (clauses.length === 0) {
    return splitParagraphs(text);
  }

  const preamble = preambleLines.join("\n").trim();
  const result: Clause[] = [];

  if (preamble.length > 0) {
    result.push({ no: "머리말", title: "", body: preamble });
  }

  result.push(...clauses);
  return result;
}
