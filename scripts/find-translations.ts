#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';

// 忽略的文件和目录
const ignorePatterns = [
  'node_modules',
  'dist',
  '.git',
  '__tests__',
  'test',
  'playground',
  '*.d.ts',
  '*.spec.ts',
  '*.test.ts',
  'i18n/locales',
];

interface TranslationItem {
  text: string;
  file: string;
  line: number;
  context: string;
}

function shouldIgnore(filePath: string): boolean {
  return ignorePatterns.some(pattern => {
    if (pattern.startsWith('*')) {
      return filePath.endsWith(pattern.slice(1));
    }
    return filePath.includes(pattern);
  });
}

function extractTextsFromFile(filePath: string): TranslationItem[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const results: TranslationItem[] = [];
  
  // 检查文件是否已经使用了翻译
  if (content.includes('useTranslations') || content.includes('t(')) {
    return []; // 已经翻译过的文件跳过
  }

  // 匹配模式
  const patterns = [
    // JSX文本内容: >Some Text<
    />([A-Z][A-Za-z\s&!?:]{3,100})</g,
    // placeholder属性
    /placeholder=["']([A-Z][A-Za-z\s&!?:]{3,100})["']/g,
    // title属性
    /title=["']([A-Z][A-Za-z\s&!?:]{3,100})["']/g,
    // aria-label属性
    /aria-label=["']([A-Z][A-Za-z\s&!?:]{3,100})["']/g,
    // label属性
    /label=["']([A-Z][A-Za-z\s&!?:]{3,100})["']/g,
    // description属性
    /description=["']([A-Z][A-Za-z\s&!?:]{3,100})["']/g,
    // 普通字符串
    /['"]([A-Z][A-Za-z\s&!?:]{3,100})['"]/g,
  ];

  lines.forEach((line, lineIndex) => {
    patterns.forEach(pattern => {
      const regex = new RegExp(pattern.source, 'g');
      let match;
      while ((match = regex.exec(line)) !== null) {
        const text = match[1].trim();
        // 过滤条件
        if (
          text.length >= 3 && 
          text.length <= 100 &&
          /^[A-Z]/.test(text) && // 首字母大写
          !text.includes('{') && 
          !text.includes('}') &&
          !text.includes('$') &&
          !text.includes('%') &&
          !text.includes('@') &&
          !text.includes('#') &&
          !text.includes('\\') &&
          !/^[a-z]+$/.test(text) && // 不是全部小写
          !/^[A-Z]+$/.test(text) && // 不是全部大写
          !text.startsWith('http') &&
          !text.startsWith('ftp') &&
          !text.includes('/') &&
          !text.includes('\\') &&
          !text.includes('.ts') &&
          !text.includes('.js') &&
          !text.includes('.json') &&
          !text.includes('.css') &&
          !text.includes('.html') &&
          !text.includes('npm') &&
          !text.includes('yarn') &&
          !text.includes('bun') &&
          !text.includes('pnpm') &&
          !text.includes('Styled') &&
          !text.includes('Icon') &&
          !text.includes('Button') &&
          !text.includes('Menu') &&
          !text.includes('Dialog') &&
          !text.includes('Tooltip')
        ) {
          // 获取上下文
          const contextStart = Math.max(0, lineIndex - 2);
          const contextEnd = Math.min(lines.length, lineIndex + 3);
          const contextLines = lines.slice(contextStart, contextEnd);
          const context = contextLines.map((l, i) => {
            const lineNum = contextStart + i + 1;
            return `${lineNum}: ${l}`;
          }).join('\n');
          
          results.push({
            text,
            file: filePath,
            line: lineIndex + 1,
            context
          });
        }
      }
    });
  });

  return results;
}

function scanDirectory(dir: string, allResults: TranslationItem[] = []): TranslationItem[] {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      if (!shouldIgnore(filePath)) {
        scanDirectory(filePath, allResults);
      }
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      if (!shouldIgnore(filePath)) {
        const results = extractTextsFromFile(filePath);
        allResults.push(...results);
      }
    }
  });

  return allResults;
}

function generateKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toCamelCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^\s+/, '');
}

function main() {
  const startDir = path.join(__dirname, '..', 'apps', 'electron', 'src', 'renderer');
  console.log(`Scanning directory: ${startDir}`);

  const allResults = scanDirectory(startDir);
  
  // 按文件分组
  const groupedByFile = new Map<string, TranslationItem[]>();
  allResults.forEach(item => {
    if (!groupedByFile.has(item.file)) {
      groupedByFile.set(item.file, []);
    }
    groupedByFile.get(item.file)!.push(item);
  });

  // 生成markdown文档
  let mdContent = `# 中文翻译待处理列表

> 生成时间: ${new Date().toISOString()}
> 扫描目录: ${startDir}
> 发现文件数: ${groupedByFile.size}
> 发现文本数: ${allResults.length}

---

## 目录

`;

  // 添加目录
  Array.from(groupedByFile.keys()).sort().forEach(filePath => {
    const relativePath = path.relative(path.join(__dirname, '..'), filePath);
    mdContent += `- [${path.basename(filePath)}](#${relativePath.replace(/[^a-zA-Z0-9]/g, '-')})\n`;
  });

  mdContent += '\n---\n\n';

  // 添加每个文件的详细内容
  Array.from(groupedByFile.entries()).sort(([a], [b]) => a.localeCompare(b)).forEach(([filePath, items]) => {
    const relativePath = path.relative(path.join(__dirname, '..'), filePath);
    
    mdContent += `## ${relativePath}\n\n`;
    mdContent += `文件路径: \`${filePath}\`\n\n`;
    mdContent += `待翻译数量: ${items.length}\n\n`;
    
    items.sort((a, b) => a.line - b.line).forEach(item => {
      const key = toCamelCase(item.text);
      
      mdContent += `### 第 ${item.line} 行: "${item.text}"\n\n`;
      mdContent += `- 建议键名: \`${key}\`\n`;
      mdContent += `- 英文原文: \`${item.text}\`\n`;
      mdContent += `- 中文翻译: [待填写]\n`;
      mdContent += '\n**上下文:**\n\n';
      mdContent += '```\n';
      mdContent += item.context + '\n';
      mdContent += '```\n\n';
      mdContent += '---\n\n';
    });
  });

  // 保存markdown文档
  const outputPath = path.join(__dirname, '..', 'TRANSLATION_TODO.md');
  fs.writeFileSync(outputPath, mdContent, 'utf-8');
  console.log(`\n✅ 翻译待办列表已生成: ${outputPath}`);
  console.log(`   - 文件数: ${groupedByFile.size}`);
  console.log(`   - 文本数: ${allResults.length}`);

  // 同时生成一个简单的JSON格式，方便后续处理
  const jsonOutput: any[] = [];
  allResults.forEach(item => {
    const relativePath = path.relative(path.join(__dirname, '..'), item.file);
    jsonOutput.push({
      file: relativePath,
      line: item.line,
      text: item.text,
      key: toCamelCase(item.text)
    });
  });

  const jsonPath = path.join(__dirname, '..', 'translation-todo.json');
  fs.writeFileSync(jsonPath, JSON.stringify(jsonOutput, null, 2), 'utf-8');
  console.log(`\n✅ JSON格式也已生成: ${jsonPath}`);
}

main();
