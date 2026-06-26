import { describe, expect, test } from 'bun:test';
import { extractSubstitutesPayload, parseFencedBlock, scoreSubstitutes, surfaceCanon } from './substitutes';

describe('surfaceCanon', () => {
  test('无损表面规范:大小写/全半角/折叠空白', () => {
    expect(surfaceCanon('lm2904dr')).toBe('LM2904DR');
    // 全角空格 U+3000 → 半角并折叠
    expect(surfaceCanon('FX5-EIP　')).toBe('FX5-EIP');
    // 连续空白折叠为单个,不删除
    expect(surfaceCanon('MT62F1G64D4EK-023  AAT:C')).toBe('MT62F1G64D4EK-023 AAT:C');
    // 全角冒号 → 半角
    expect(surfaceCanon('MT62F1G64D4EK-023 AAT：C')).toBe('MT62F1G64D4EK-023 AAT:C');
  });

  test('禁止改变型号身份:后缀/破折号/有无空格都保留区分', () => {
    // 不剥后缀:基础型号与订货号是不同身份
    expect(surfaceCanon('LM2904')).not.toBe(surfaceCanon('LM2904DR'));
    // 不删破折号
    expect(surfaceCanon('LM358-N')).not.toBe(surfaceCanon('LM358N'));
    // 有无空格保留区分(宁可漏判,交复审补集合)
    expect(surfaceCanon('023 AAT')).not.toBe(surfaceCanon('023AAT'));
  });
});

describe('parseFencedBlock', () => {
  const answer = [
    '这是一些前言文字。',
    '```substitutes',
    '{"original":"X","substitutes":[{"mpn":"LM2904DR"}]}',
    '```',
    '后记。',
  ].join('\n');

  test('抠出栅栏块并解析', () => {
    const parsed = parseFencedBlock(answer, 'substitutes') as any;
    expect(parsed.original).toBe('X');
    expect(parsed.substitutes[0].mpn).toBe('LM2904DR');
  });

  test('缺块 → null', () => {
    expect(parseFencedBlock('没有任何块', 'substitutes')).toBeNull();
  });

  test('JSON 畸形 → null', () => {
    const bad = '```substitutes\n{not valid json}\n```';
    expect(parseFencedBlock(bad, 'substitutes')).toBeNull();
  });
});

describe('extractSubstitutesPayload — 按形状不认标签', () => {
  test('标签写成 ```json 也能抠出', () => {
    const answer = '前言\n```json\n{"original":"X","substitutes":[{"mpn":"LM2904DR"}]}\n```';
    const p = extractSubstitutesPayload(answer)!;
    expect(p.substitutes![0].mpn).toBe('LM2904DR');
  });

  test('裸 ``` 块也能抠出', () => {
    const answer = '```\n{"substitutes":[{"mpn":"A"}]}\n```';
    expect(extractSubstitutesPayload(answer)!.substitutes![0].mpn).toBe('A');
  });

  test('跳过不相关的 fenced 块,取第一个带 substitutes 的', () => {
    const answer = '```bash\nls -la\n```\n```json\n{"substitutes":[{"mpn":"B"}]}\n```';
    expect(extractSubstitutesPayload(answer)!.substitutes![0].mpn).toBe('B');
  });

  test('无任何带 substitutes 的块 → null', () => {
    expect(extractSubstitutesPayload('```json\n{"foo":1}\n```')).toBeNull();
    expect(extractSubstitutesPayload('没有块')).toBeNull();
  });
});

describe('scoreSubstitutes (closed)', () => {
  const expected = {
    acceptable: ['LM2904DR', 'NE5532DR', 'TLV9062IDR'],
    mustFind: ['LM2904DR'],
    forbidden: ['LM386'],
  };

  test('命中关键 + 全在范围内 → 绿', () => {
    const s = scoreSubstitutes({ substitutes: [{ mpn: 'lm2904dr' }, { mpn: 'NE5532DR' }] }, expected);
    expect(s.pass).toBe(true);
    expect(s.recall).toBe(1);
    expect(s.precision).toBe(1);
  });

  test('漏关键替代 → 红', () => {
    const s = scoreSubstitutes({ substitutes: [{ mpn: 'NE5532DR' }] }, expected);
    expect(s.pass).toBe(false);
    expect(s.missedMustFind).toEqual(['LM2904DR']);
  });

  test('推了范围外 → precision 掉 → 红(closed)', () => {
    const s = scoreSubstitutes({ substitutes: [{ mpn: 'LM2904DR' }, { mpn: 'SOMETHINGELSE' }] }, expected);
    expect(s.pass).toBe(false);
    expect(s.precision).toBeCloseTo(0.5);
  });

  test('踩禁止项 → 红', () => {
    const s = scoreSubstitutes({ substitutes: [{ mpn: 'LM2904DR' }, { mpn: 'LM386' }] }, expected);
    expect(s.pass).toBe(false);
    expect(s.forbiddenHit).toEqual(['LM386']);
  });

  test('没交卷(null) → 红', () => {
    const s = scoreSubstitutes(null, expected);
    expect(s.pass).toBe(false);
    expect(s.reason).toContain('没交卷');
  });
});

describe('scoreSubstitutes — mustFind 别名组(同料不同印法)', () => {
  const expected = {
    acceptable: ['534260410', '53426-0410'],
    mustFind: [['534260410', '53426-0410']],
  };

  test('命中组内任一别名 → 绿', () => {
    const s = scoreSubstitutes({ substitutes: [{ mpn: '53426-0410' }] }, expected);
    expect(s.pass).toBe(true);
    expect(s.recall).toBe(1);
  });

  test('两别名都没给 → 红', () => {
    const s = scoreSubstitutes({ substitutes: [{ mpn: '534260999' }] }, expected);
    expect(s.pass).toBe(false);
    expect(s.missedMustFind).toEqual(['534260410']); // 报代表写法
  });

  test('字母后缀不在别名组里 → 仍漏(RTC-7301SF:B ≠ RTC-7301SF)', () => {
    const s = scoreSubstitutes(
      { substitutes: [{ mpn: 'RTC-7301SF:B' }] },
      { acceptable: ['RTC-7301SF'], mustFind: ['RTC-7301SF'] }
    );
    expect(s.pass).toBe(false);
  });
});
