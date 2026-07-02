# 配方:批量任务结果写回(procurement-batch-orchestration 用)

三步:建批次实例(飞书建表+本地注册)→ 各子任务本地落行 → 收口后推上飞书。

    # ① 父任务建实例,--title 用批次 ID;--app 是目标飞书 Base 的 token
    larkdepot state create --template batch-result --title "<批次ID>" --app <base_token>

    # ② 子任务逐行本地写(不碰飞书,不吃限流;字段必须在模板内)
    larkdepot state write "<批次ID>" --json '{"批次ID":"<批次ID>","型号":"<X>","品牌":"<可空>","结果状态":"<found|not_found|incomplete>","结果JSON":"<细节打包成JSON字符串>"}'

    # ③ 读回核对 / 收口汇总
    larkdepot state list "<批次ID>"
    larkdepot query sql --sql "SELECT * FROM batch_results WHERE _instance='<批次ID>'" --db state

    # ④ 全部收齐后一次推上飞书(幂等:中途崩溃重跑不会重复建行,失败行下次自动重试)
    larkdepot push --table "<批次ID>"

- 模板字段就 5 个:批次ID/型号/品牌/结果状态/结果JSON。业务细节(平台覆盖/报价/货期/待确认项…)全部打包进「结果JSON」一个字段,不要试图写模板外的字段(会被拒绝,退出码 1)。
- `state list` 每行带 `_pushed` 布尔:true = 已推上飞书。
- push 部分失败退出码 3,envelope 里有逐表统计;直接重跑即可,已成功的行不会重复。
