# 配方:供应商档案三字段检索(procurement-supplier-shortlist 用)

查**供应商档案**一张表,品牌/品类跨「主营品牌」「优势产品」「询价品牌」三列匹配:

    larkdepot base +record-search --table-id 供应商档案 --keyword "<关键词>" \
      --search-field 主营品牌 --search-field 优势产品 --search-field 询价品牌 \
      --field-id 供应商全称 --field-id 供应商类型 --field-id 供应商等级 --field-id 主营品牌 \
      --field-id 优势产品 --field-id 联系方式 --field-id 联系媒介 --field-id "官网|店铺" \
      --field-id 供应商状态 --field-id 备注 --field-id 总分 --limit 50

- 子串匹配忽略大小写、自动内建,关键词直接给(品牌中英文各查一次,结果合并去重)。
- 品类词(继电器/连接器)直接当关键词——优势产品列会命中。
- `--field-id` 的列名以 `larkdepot schema` 输出为准(不存在的列自动忽略,但别依赖这个容错)。
