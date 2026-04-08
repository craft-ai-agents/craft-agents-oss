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
  '*.test.ts'
];

// 匹配模式 - 查找UI文本字符串
const patterns = [
  // JSX中的文本内容
  />([A-Z][A-Za-z\s&!?:]+)</g,
  // placeholder属性
  /placeholder=["']([^"']+)["']/g,
  // title属性
  /title=["']([^"']+)["']/g,
  // aria-label属性
  /aria-label=["']([^"']+)["']/g,
  // label属性
  /label=["']([^"']+)["']/g,
  // description属性
  /description=["']([^"']+)["']/g,
  // 普通字符串 - 过滤掉太短的
  /['"]([A-Z][A-Za-z\s&!?:]{3,})['"]/g,
];

interface TextInfo {
  text: string;
  files: string[];
  contexts: string[];
}

function shouldIgnore(filePath: string): boolean {
  return ignorePatterns.some(pattern => {
    if (pattern.startsWith('*')) {
      return filePath.endsWith(pattern.slice(1));
    }
    return filePath.includes(pattern);
  });
}

function extractTexts(filePath: string): TextInfo[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const results: TextInfo[] = [];
  const texts = new Map<string, string[]>();

  // 检查文件是否已经使用了翻译
  if (content.includes('useTranslations') || content.includes('t(')) {
    return []; // 已经翻译过的文件跳过
  }

  patterns.forEach(pattern => {
    let match;
    const regex = new RegExp(pattern.source, 'g');
    while ((match = regex.exec(content)) !== null) {
      const text = match[1].trim();
      // 过滤条件
      if (
        text.length >= 3 && 
        text.length <= 100 &&
        /^[A-Z]/.test(text) && // 首字母大写
        !text.includes('{') && // 不包含变量
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
        !text.includes('pnpm')
      ) {
        if (!texts.has(text)) {
          texts.set(text, []);
        }
        // 获取上下文
        const start = Math.max(0, match.index - 50);
        const end = Math.min(content.length, match.index + match[0].length + 50);
        const context = content.slice(start, end).replace(/\s+/g, ' ').trim();
        texts.get(text)!.push(context);
      }
    }
  });

  texts.forEach((contexts, text) => {
    results.push({
      text,
      files: [filePath],
      contexts
    });
  });

  return results;
}

function scanDirectory(dir: string, allTexts: Map<string, TextInfo> = new Map()): Map<string, TextInfo> {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      if (!shouldIgnore(filePath)) {
        scanDirectory(filePath, allTexts);
      }
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      if (!shouldIgnore(filePath)) {
        const texts = extractTexts(filePath);
        texts.forEach(textInfo => {
          if (allTexts.has(textInfo.text)) {
            const existing = allTexts.get(textInfo.text)!;
            existing.files.push(...textInfo.files);
            existing.contexts.push(...textInfo.contexts);
          } else {
            allTexts.set(textInfo.text, textInfo);
          }
        });
      }
    }
  });

  return allTexts;
}

function main() {
  const startDir = path.join(__dirname, '..', 'apps', 'electron', 'src', 'renderer');
  console.log(`Scanning directory: ${startDir}`);

  const allTexts = scanDirectory(startDir);
  
  // 转换为数组并排序
  const sortedTexts = Array.from(allTexts.values()).sort((a, b) => a.text.localeCompare(b.text));

  console.log(`\nFound ${sortedTexts.length} potential UI texts:\n`);

  // 输出结果
  const output: any[] = [];
  sortedTexts.forEach((textInfo, index) => {
    console.log(`${index + 1}. "${textInfo.text}"`);
    console.log(`   Files: ${textInfo.files.length} files`);
    console.log(`   First file: ${textInfo.files[0]}`);
    console.log('');

    output.push({
      text: textInfo.text,
      files: textInfo.files,
      contexts: textInfo.contexts.slice(0, 3) // 只保留前3个上下文
    });
  });

  // 保存到JSON文件
  const outputPath = path.join(__dirname, '..', 'ui-texts.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\nResults saved to: ${outputPath}`);

  // 生成翻译键建议
  const keysOutput: any[] = [];
  sortedTexts.forEach(textInfo => {
    const key = textInfo.text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '');
    
    keysOutput.push({
      key,
      en: textInfo.text,
      zh: '', // 留空让用户填写中文翻译
      files: textInfo.files
    });
  });

  const keysOutputPath = path.join(__dirname, '..', 'translation-keys.json');
  fs.writeFileSync(keysOutputPath, JSON.stringify(keysOutput, null, 2), 'utf-8');
  console.log(`Translation keys saved to: ${keysOutputPath}`);
}

main();
