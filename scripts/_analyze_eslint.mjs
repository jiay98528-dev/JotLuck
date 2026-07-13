import { readFileSync } from 'fs';

const data = JSON.parse(readFileSync('D:/eslint-output.json', 'utf-8'));

// 1. Total errors and warnings
let totalErrors = 0,
  totalWarnings = 0;
const fileDetails = [];

for (const f of data) {
  totalErrors += f.errorCount;
  totalWarnings += f.warningCount;
  if (f.messages && f.messages.length > 0) {
    fileDetails.push({
      filePath: f.filePath,
      errorCount: f.errorCount,
      warningCount: f.warningCount,
      messages: f.messages,
    });
  }
}

console.log('=== 1. 错误与警告总数 ===');
console.log('错误总数:', totalErrors);
console.log('警告总数:', totalWarnings);
console.log('涉及文件数:', fileDetails.length);
console.log();

// 2. By rule
const ruleCounts = {};
const ruleSeverity = {};
const ruleFileDetails = {};
for (const f of fileDetails) {
  for (const m of f.messages) {
    const key = m.ruleId || '(unknown)';
    ruleCounts[key] = (ruleCounts[key] || 0) + 1;
    if (!ruleSeverity[key]) ruleSeverity[key] = m.severity;
    if (!ruleFileDetails[key]) ruleFileDetails[key] = [];
    const pathParts = f.filePath.replace(/\\\\/g, '/').split('/');
    ruleFileDetails[key].push({
      file: pathParts[pathParts.length - 1],
      line: m.line,
      message: m.message,
    });
  }
}

const sortedRules = Object.entries(ruleCounts).sort((a, b) => b[1] - a[1]);
const topN = Math.min(10, sortedRules.length);
console.log('=== 2. 按规则分组统计 (Top ' + topN + ') ===');
console.log('规则ID | 数量 | 严重度');
console.log('-------|------|--------');
let rank = 0;
for (const [rule, count] of sortedRules) {
  rank++;
  const severity = ruleSeverity[rule] === 2 ? 'Error' : 'Warn';
  console.log(rank + '. ' + rule + ' | ' + count + ' | ' + severity);
  if (rank <= 10) {
    const details = ruleFileDetails[rule] || [];
    for (const d of details.slice(0, 3)) {
      console.log('   -> ' + d.file + ':' + d.line + ' - ' + d.message);
    }
  }
}
console.log();

// 3. By file
const fileCounts = {};
for (const f of fileDetails) {
  const parts = f.filePath.replace(/\\\\/g, '/').split('/');
  const short = parts.slice(-3).join('/');
  fileCounts[short] = (fileCounts[short] || 0) + f.messages.length;
}
const sortedFiles = Object.entries(fileCounts).sort((a, b) => b[1] - a[1]);
const topFiles = Math.min(10, sortedFiles.length);
console.log('=== 3. 按文件分组统计 (Top ' + topFiles + ') ===');
console.log('文件路径 | 问题数');
console.log('---------|--------');
rank = 0;
for (const [file, count] of sortedFiles) {
  rank++;
  console.log(rank + '. ' + file + ' | ' + count);
}
console.log();

// 4. Check for specific patterns
console.log('=== 4. 严重问题检查 ===');
const patterns = [
  { name: 'any 类型逃逸 (@ts-expect-error / @ts-ignore)', regex: /@ts-expect-error|@ts-ignore/ },
  { name: 'no-explicit-any', regex: /no-explicit-any/ },
  { name: 'unused vars', regex: /no-unused-vars/ },
  { name: 'missing deps (vue/require-expose)', regex: /vue\/require-expose/ },
  { name: 'no-var', regex: /no-var/ },
  { name: 'prefer-const', regex: /prefer-const/ },
];

let foundPattern = false;
for (const [rule, details] of Object.entries(ruleFileDetails)) {
  for (const p of patterns) {
    if (p.regex.test(rule)) {
      console.log('  ' + p.name + ': ' + rule + ' (' + details.length + ' 条)');
      for (const d of details.slice(0, 3)) {
        console.log('    ' + d.file + ':' + d.line + ' - ' + d.message);
      }
      foundPattern = true;
    }
  }
}
if (!foundPattern) console.log('  未发现 any 类型逃逸、unused vars、missing deps 等严重问题');
console.log();

// 5. Score
const totalIssues = totalErrors + totalWarnings;
let score, msg;
if (totalErrors === 0 && totalWarnings === 0) {
  score = 'A+';
  msg = '零错误零警告，完美规范';
} else if (totalErrors === 0 && totalWarnings <= 5) {
  score = 'A';
  msg = '零错误，少量警告，近乎完美';
} else if (totalErrors === 0 && totalWarnings <= 20) {
  score = 'B';
  msg = '零错误，警告较多';
} else if (totalErrors === 0) {
  score = 'C';
  msg = '零错误，大量警告';
} else if (totalErrors <= 5) {
  score = 'C-';
  msg = '少量错误';
} else if (totalErrors <= 20) {
  score = 'D';
  msg = '较多错误';
} else {
  score = 'F';
  msg = '大量错误';
}

console.log('=== 5. 代码规范符合度评分 ===');
console.log('评分等级:', score);
console.log('评估:', msg);
console.log('总问题数:', totalIssues, '(错误:' + totalErrors + ', 警告:' + totalWarnings + ')');
