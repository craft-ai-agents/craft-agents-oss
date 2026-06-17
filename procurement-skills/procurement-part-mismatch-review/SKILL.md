---
name: procurement-part-mismatch-review
description: 当采购需求型号与供应商报价型号不一致时，基于公开资料判断二者能否互相替代、差异是否影响使用，并给出证据。当用户同时给出“需求型号”和“报价型号”且两者不同（后缀/封装/批次差异），问“这俩能不能用/有没有区别/能替代吗”时使用。
metadata:
  short-description: 采购/报价型号差异判断
  lang: zh
---

# 采购/报价型号差异判断

输入两个不同型号（采购型号 + 报价型号），判断报价型号能不能接受、差异是否影响使用，给证据。

**核心方法 = 拿两个型号的关键规格逐项对比**：替代规格覆盖采购型号的要求就能用，任一关键项不满足就不能用，关键规格查不到就需补料。原厂/授权渠道的明确替代或 cross-reference 是**强证据**（有就直接采信），但**不是必须**——规格对比本身就能下结论。

**先看是不是「同一颗芯片」**：把两个 MPN 拆成 基础料号 + 封装/后缀代码。若**基础料号相同、只后缀/封装不同**（如 `TPS92550TZ` vs `TPS92550TZX`，`/NOPB`=无铅），那是**同一颗芯片的不同封装/包装/无铅版本**，电气规格一致——只需核对**封装是否兼容（footprint/引脚）**和包装/无铅是否可接受，别因"封装代码不同"就一律判不能用。这通常是最容易接受的差异。

## 第一步：拿两个型号的关键规格（优先结构化源，比挨个开网页快准）

1. **Octopart 对比表（最省事，原型号 vs 替代并排列规格）**：

       cloakbrowser-python .agents/skills/procurement-platform-search/scripts/cloak_search.py --part "<采购型号>" --source octopart-alt 2>/dev/null

   若报价型号正好在它的 Alternate Parts 里，直接读两边封装/引脚/电参数/温度等对比。

2. **api_search（Digikey/Mouser，拿厂牌/描述/封装/datasheet）**，对两个型号各跑一次：

       python3 .agents/skills/procurement-platform-search/scripts/api_search.py --part "<型号>"

3. **datasheet / 原厂页**：上面给了 datasheet 链接，需要细规格（精度/温度/pin 定义）就用 WebFetch 打开核对；原厂页反爬抓不到时用 `cloak_search.py --source master` 或 `cloak_fetch.py`。需要系统化搜原厂资料时读 [references/search-workflow.md](references/search-workflow.md)。

按品类锁定**关键规格项**：封装/引脚、核心电参数（电压/电流/精度/容值/阻值/功率/频率/速度）、Memory/接口/协议、温度等级、认证、生命周期。

## 第二步：逐项对比下结论

把报价型号的每个关键项和采购型号比，收敛到三类（细则见 [references/decision-rules.md](references/decision-rules.md)）：

- **能用**：所有关键项，报价型号都满足/覆盖采购型号要求（或有原厂/授权渠道明确替代、cross-reference、同订货项）。
- **不能用**：任一关键项冲突（封装不同、电压不够、精度更差、温度等级更低、pin 不兼容、容值/阻值不同等）。
- **需补料**：关键项查不到资料，无法确认。细化缺口：缺规格资料 / 缺替代关系证据 / 缺客户使用要求。

别只凭型号字符串相近或封装相近就说能用——必须有规格支撑。容易误判的边界样例见 [references/minimal-acceptance.md](references/minimal-acceptance.md)。

## 输出 + 边界

- 只用业务语言输出，格式见 [references/output-format.md](references/output-format.md)。
- 单型号对约 2 分钟：先看结构化对比，缺的关键项再开 datasheet 补；超时就用现有资料收口并说明缺口。
- 页面打不开/资料缺，如实写成阻碍/需补料，不能当差异不存在。
- 只处理两个型号能否互用。
