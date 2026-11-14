import { loadCriteria } from "../lib/criteria.ts";

const types = ["work", "rent", "common"];

for (const type of types) {
  const items = loadCriteria(type);
  const unverifiedCount = items.filter((item) => !item.basis.verified).length;
  console.log(`${type}: 항목 ${items.length}개, verified=false ${unverifiedCount}개`);
}
