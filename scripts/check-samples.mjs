import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const answersPath = path.join(projectRoot, "data", "answers.json");
const samplesDir = path.join(projectRoot, "data", "samples");

const answers = JSON.parse(fs.readFileSync(answersPath, "utf-8"));

let hasMismatch = false;

for (const [fileName, items] of Object.entries(answers)) {
  const samplePath = path.join(samplesDir, fileName);

  if (!fs.existsSync(samplePath)) {
    console.log(`[MISMATCH] ${fileName}: 샘플 파일이 없습니다 (${samplePath})`);
    hasMismatch = true;
    continue;
  }

  const content = fs.readFileSync(samplePath, "utf-8");

  let riskCount = 0;
  let cleanCount = 0;
  let unconfirmedCount = 0;

  for (const item of items) {
    if (!content.includes(item.clause)) {
      console.log(`[MISMATCH] ${fileName}: "${item.clause}"을 본문에서 찾을 수 없습니다`);
      hasMismatch = true;
    }

    if (item.expected === "risk") riskCount += 1;
    if (item.expected === "clean") cleanCount += 1;
    if (item.confirmed === false) unconfirmedCount += 1;
  }

  console.log(
    `${fileName}: risk ${riskCount}개, clean ${cleanCount}개, confirmed=false ${unconfirmedCount}개`
  );
}

if (hasMismatch) {
  process.exit(1);
}
