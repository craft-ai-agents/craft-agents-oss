# 配方:库存跨 7 表查询(procurement-local-inventory-lookup 用)

库存 = 7 张表:动态库存表(动态)/自家库存(自家)/A级供应商库存(A)/B级供应商库存1-3(B1/B2/B3)/C级供应商库存(C)。

各表字段名不完全一致(型号列可能叫"型号"/"品名"/"料号",库存列可能叫"库存数量"/"数量"),**先 `larkdepot schema` 核对真实列名**,再套模板:

    larkdepot query sql --sql "
      SELECT '动态' AS 等级, 型号, 品牌, 库存数量 AS 库存, 单价, 供应商名称 AS 供应商, 更新时间
      FROM 动态库存表 WHERE norm(型号)=norm('<型号>')
      UNION ALL
      SELECT '自家', 型号, 品牌, 库存数量, 单价, NULL, 更新时间
      FROM 自家库存 WHERE norm(型号)=norm('<型号>')
      UNION ALL
      -- A/B1/B2/B3/C 五张表同理,列名以 schema 输出为准
    "

- 每张表用 `norm(<该表的型号列>)=norm('<型号>')` 各自匹配,`UNION ALL` 一次查完全部等级,别漏表。
- `norm()` 已做变体归一(去 `-`/`/`/空格+大写),不必造变体词逐表试;近似命中(如尾缀差异)工具不会替你判断,SQL 命中后自己逐字符复核。
- envelope `freshness.synced_at` 随行返回,给业务侧展示"缓存快照时间"用。
