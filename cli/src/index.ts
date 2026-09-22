import { readFileSync } from "node:fs";
import { call, CliFailure, exitCodeOf, loadConfig, type CliConfig } from "./client";

/**
 * wc-cli —— 玮川进销存的命令行入口。
 *
 * 设计取向（给 Agent 用，计划 §6.3 / §7）：
 * - 默认输出 **JSON**（机器可读），`--table` 才是给人看的排版；
 * - 退出码规范化：0 成功 / 2 参数错 / 3 权限不足 / 4 业务规则拒绝 / 5 冲突 / 1 其他；
 * - 每条命令都要有 `--help` 与**示例**（Agent 最依赖示例）。
 *
 * 命令面现在只有鉴权自检（Phase 1 的最小闭环：能证明 CLI 拿到了合法身份）。
 * 查询与写命令按 Phase 2/3 逐步接上，接的时候只需在 COMMANDS 里加一行——
 * 权限判定不在 CLI 里做，一律由服务端注册表（src/lib/cli/registry.ts）说了算。
 */

interface Command {
  /** 服务端注册表里的 op 名 */
  op: string;
  summary: string;
  usage: string[];
  examples: string[];
}

const COMMANDS: Record<string, Command> = {
  "auth.whoami": {
    op: "auth.whoami",
    summary: "显示当前令牌对应的身份与权限（排查令牌配错的第一站）",
    usage: ["wc-cli auth whoami [--json|--table]"],
    examples: ["wc-cli auth whoami", "wc-cli auth whoami --table"],
  },
  "auth.check-review": {
    op: "auth.check-review",
    summary: "自检：人类专属操作，Agent 令牌调用必被拒绝（验证权限判定真的在生效）",
    usage: ["wc-cli auth check-review"],
    examples: ["wc-cli auth check-review   # Agent 令牌应得到退出码 3"],
  },
  "query.orders": {
    op: "query.orders",
    summary: "查售卖单列表（默认本月 1 日至今，与网页列表同口径）",
    usage: [
      "wc-cli query orders [--page N] [--page-size N] [--from YYYY-MM-DD] [--to YYYY-MM-DD]",
      "                    [--status confirmed|voided] [--settle settled|unsettled]",
      "                    [--customer-id N] [--q 关键词] [--starred]",
      "                    [--origin agent|human] [--review pending_review|approved|rejected] [--table]",
    ],
    examples: [
      "wc-cli query orders --table",
      "wc-cli query orders --settle unsettled --table   # 只看未结清",
      "wc-cli query orders --q zjw --from 2026-09-01 --to 2026-09-30",
      "wc-cli query orders --page 2 --page-size 50",
      "wc-cli query orders --origin agent --table          # 只看 Agent 代做的",
      "wc-cli query orders --review pending_review --table # 只看还没复核的",
    ],
  },
  "query.purchase-orders": {
    op: "query.purchase-orders",
    summary: "查进货单列表（默认本月 1 日至今）",
    usage: [
      "wc-cli query purchase-orders [--page N] [--page-size N] [--from YYYY-MM-DD] [--to YYYY-MM-DD]",
      "                              [--status pending|received|voided] [--settle settled|unsettled]",
      "                              [--supplier-id N] [--q 关键词] [--starred] [--table]",
    ],
    examples: [
      "wc-cli query purchase-orders --table",
      "wc-cli query purchase-orders --status pending --table    # 待收货的",
      "wc-cli query purchase-orders --settle unsettled --table  # 还欠厂家钱的",
    ],
  },
  "query.inventory": {
    op: "query.inventory",
    summary: "查库存（--warn-only 只看跌破预警线的）",
    usage: [
      "wc-cli query inventory [--page N] [--page-size N] [--q 关键词] [--warn-only]",
      "                       [--category N|none] [--manufacturer 名|none]",
      "                       [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--table]",
    ],
    examples: [
      "wc-cli query inventory --table",
      "wc-cli query inventory --warn-only --table   # 只看跌破预警线的",
      "wc-cli query inventory --q zjw --table       # 拼音首字母也能搜",
    ],
  },
  "query.products": {
    op: "query.products",
    summary: "查商品档案（开单前用它把商品名换成 id）",
    usage: [
      "wc-cli query products [--q 关键词] [--page N] [--page-size N]",
      "                      [--category N|none] [--manufacturer 名|none] [--enabled-only] [--table]",
    ],
    examples: [
      "wc-cli query products --q dxtx --table        # 拼音首字母搜「单芯铜线」",
      "wc-cli query products --manufacturer none --table   # 还没填厂家的商品",
      "wc-cli query products --category none --table       # 还没分类的商品",
    ],
  },
  "query.customers": {
    op: "query.customers",
    summary: "查客户（名称/电话/分组/标签）",
    usage: [
      "wc-cli query customers [--q 关键词] [--page N] [--page-size N]",
      "                       [--group-id N|none] [--tag-id N] [--table]",
    ],
    examples: [
      "wc-cli query customers --q zjw --table",
      "wc-cli query customers --group-id none --table   # 还没分组的客户",
    ],
  },
  "query.suppliers": {
    op: "query.suppliers",
    summary: "查厂家（含该厂家名下商品数）",
    usage: ["wc-cli query suppliers [--q 关键词] [--status 1|0] [--page N] [--table]"],
    examples: ["wc-cli query suppliers --table", "wc-cli query suppliers --q yddl --table"],
  },
  "query.units": {
    op: "query.units",
    summary: "查单位（开单要填 unitId）",
    usage: ["wc-cli query units [--q 关键词] [--table]"],
    examples: ["wc-cli query units --table"],
  },
  "query.categories": {
    op: "query.categories",
    summary: "查商品分类（补单/建档要填 categoryId）",
    usage: ["wc-cli query categories [--q 关键词] [--table]"],
    examples: ["wc-cli query categories --table"],
  },
  "query.receivables": {
    op: "query.receivables",
    summary: "查应收（两个合计口径都在返回里：区间合计 / 当前存量）",
    usage: [
      "wc-cli query receivables [--counter-id N] [--from YYYY-MM-DD] [--to YYYY-MM-DD]",
      "                      [--page N] [--page-size N] [--table]",
    ],
    examples: [
      "wc-cli query receivables --table",
      "wc-cli query receivables --counter-id 1 --table   # 只看某个客户的",
    ],
  },
  "query.payables": {
    op: "query.payables",
    summary: "查应付（还欠厂家多少钱）",
    usage: [
      "wc-cli query payables [--counter-id N] [--from YYYY-MM-DD] [--to YYYY-MM-DD]",
      "                     [--page N] [--page-size N] [--table]",
    ],
    examples: ["wc-cli query payables --table", "wc-cli query payables --counter-id 2 --table"],
  },
  "query.payments": {
    op: "query.payments",
    summary: "查收付款流水（默认只看已登记）",
    usage: [
      "wc-cli query payments [--direction receipt|payment] [--status confirmed|voided|all]",
      "                     [--q 关键词] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--page N] [--table]",
    ],
    examples: [
      "wc-cli query payments --table",
      "wc-cli query payments --direction receipt --table    # 只看收款",
      "wc-cli query payments --status all --table           # 含已作废",
      "wc-cli query payments --q zjw --table                # 按客户名找他的款",
    ],
  },
  "query.movements": {
    op: "query.movements",
    summary: "查库存流水（含变动前后数量与当次单价）",
    usage: [
      "wc-cli query movements [--product-id N] [--biz-type purchase_in|sale_out|...]",
      "                       [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--page N] [--table]",
    ],
    examples: [
      "wc-cli query movements --table",
      "wc-cli query movements --product-id 1 --table                     # 某个商品的进销存轨迹",
      "wc-cli query movements --biz-type sale_return_in --table          # 只看销售退货",
    ],
  },
  "query.report": {
    op: "query.report",
    summary: "跑报表（汇总同时给毛额与净额；估价待补行会标注成本未计）",
    usage: [
      "wc-cli query report [--tab inventory|summary|payables|receivables|sales-rank|operator-perf]",
      "                    [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--table]",
    ],
    examples: [
      "wc-cli query report --tab summary --table",
      "wc-cli query report --tab sales-rank --table",
      "wc-cli query report --tab summary --from 2026-09-01 --to 2026-09-30 --table",
    ],
  },
  "master.product.create": {
    op: "master.product.create",
    summary: "新建商品（**默认预演**，加 --yes 才真落库）",
    usage: [
      "wc-cli master product create --name <名称> --manufacturer <厂家> --unit-id <N>",
      "                               [--category-id N] [--ref-purchase-price 0.00]",
      "                               [--ref-sale-price 0.00] [--min-stock 1] [--yes]",
    ],
    examples: [
      "wc-cli master product create --name 'BV 2.5平方 单芯铜线' --manufacturer 远东电缆 --unit-id 1",
      "  ↑ 这是预演：只打印将要写入的内容，什么都不落库",
      "wc-cli master product create --name '...' --manufacturer '...' --unit-id 1 --yes   # 真落库",
    ],
  },
  "master.product.set-status": {
    op: "master.product.set-status",
    summary: "启用/停用商品（软删，保留历史单据引用）",
    usage: ["wc-cli master product set-status --product-id N --enabled true|false [--yes]"],
    examples: [
      "wc-cli master product set-status --product-id 3 --enabled false          # 预演停用",
      "wc-cli master product set-status --product-id 3 --enabled false --yes    # 真停用",
    ],
  },
  "master.customer.create": {
    op: "master.customer.create",
    summary: "新建/更新客户（**默认预演**；默认拒绝重名）",
    usage: [
      "wc-cli master customer create --name <名称> [--phone 138...] [--address ...] [--remark ...]",
      "                              [--group-id N] [--tag-ids 1,2] [--allow-duplicate] [--yes]",
      "wc-cli master customer update --id N --name <名称> [--phone ...] [--yes]",
    ],
    examples: [
      "wc-cli master customer create --name 张敬玮 --phone 13800000000",
      "  ↑ 预演：只打印将要写入的内容",
      "wc-cli master customer create --name 张敬玮 --phone 13800000000 --yes   # 真落库",
      "wc-cli master customer update --id 3 --name 张敬玮 --phone 13900000000 --yes",
    ],
  },
  "master.supplier.create": {
    op: "master.supplier.create",
    summary: "新建/更新厂家（**默认预演**；默认拒绝重名）",
    usage: [
      "wc-cli master supplier create --name <厂家名> [--contact ...] [--phone ...] [--allow-duplicate] [--yes]",
      "wc-cli master supplier update --id N --name <厂家名> [--yes]",
    ],
    examples: [
      "wc-cli master supplier create --name 远东电缆 --contact 王经理",
      "wc-cli master supplier create --name 远东电缆 --contact 王经理 --yes",
    ],
  },
  "master.customer.update": {
    op: "master.customer.update",
    summary: "更新客户（必须给 --id）",
    usage: ["wc-cli master customer update --id N --name <名称> [--phone ...] [--group-id N] [--tag-ids 1,2] [--yes]"],
    examples: [
      "wc-cli master customer update --id 3 --name 张敬玮 --phone 13900000000",
      "wc-cli master customer update --id 3 --name 张敬玮 --yes",
    ],
  },
  "master.supplier.update": {
    op: "master.supplier.update",
    summary: "更新厂家（必须给 --id）",
    usage: ["wc-cli master supplier update --id N --name <厂家名> [--contact ...] [--yes]"],
    examples: ["wc-cli master supplier update --id 2 --name 远东电缆 --contact 王经理 --yes"],
  },
  "order.sale.create": {
    op: "order.sale.create",
    summary: "开售卖单（**默认预演**；扣库存 + 成本快照，现场进货会自动生成进货单）",
    usage: [
      "wc-cli order sale create --customer-id N --items '<JSON 数组>' [--remark ...] [--starred] [--yes]",
      "  --items 每行的字段：productId / quantity / unitPrice 必填；",
      "           supplyPrice（现场进货进价）、stockUsed（用多少库存，留空=尽量用）、",
      "           extraQty（多补）、supplierId（缺货行指定厂家）、unitId、estimated（估价待补行）",
      "  --items @items.json  也可以从文件读（Agent 生成大数组时更稳）",
    ],
    examples: [
      "wc-cli order sale create --customer-id 1 --items '[{\"productId\":3,\"quantity\":10,\"unitPrice\":25,\"supplyPrice\":18}]'",
      "  ↑ 预演：打印将扣多少库存、成本快照多少、会不会自动生成进货单",
      "wc-cli order sale create --customer-id 1 --items @/tmp/items.json --yes   # 真落库",
    ],
  },
  "order.purchase.create": {
    op: "order.purchase.create",
    summary: "开进货单（**默认预演**；创建不等于入库，库存不动）",
    usage: [
      "wc-cli order purchase create --supplier-id N --items '<JSON 数组>' [--remark ...] [--yes]",
      "  --items 每行：productId / quantity / unitPrice 必填，remark 可选",
      "  单位取商品默认单位；货到了要再用 order purchase receive 确认入库",
    ],
    examples: [
      "wc-cli order purchase create --supplier-id 1 --items '[{\"productId\":3,\"quantity\":100,\"unitPrice\":18}]'",
      "wc-cli order purchase create --supplier-id 1 --items @/tmp/po.json --yes",
    ],
  },
  "order.purchase.receive": {
    op: "order.purchase.receive",
    summary: "确认入库（**预演会列出入库前后的数量/金额/均价**）",
    usage: ["wc-cli order purchase receive --id N [--yes]"],
    examples: [
      "wc-cli order purchase receive --id 21          # 先看均价会变成多少",
      "wc-cli order purchase receive --id 21 --yes    # 真入库",
    ],
  },
  "order.return.sale.create": {
    op: "order.return.sale.create",
    summary: "开售卖退货单（**默认预演**；成本按原单快照均价入库，估价行不入库）",
    usage: [
      "wc-cli order return sale create --order-id N --items '<JSON 数组>' [--yes]",
      "  --items 每行：orderItemId / quantity / unitPrice（不退货的行不要写进来）",
      "  原单行 id 用 query orders 看不到，用 query order --id N 或先从下单返回里拿",
    ],
    examples: [
      "wc-cli order return sale create --order-id 20020 --items '[{\"orderItemId\":20022,\"quantity\":5,\"unitPrice\":77}]'",
      "wc-cli order return sale create --order-id 20020 --items @/tmp/ret.json --yes",
    ],
  },
  "order.return.sale.void": {
    op: "order.return.sale.void",
    summary: "作废售卖退货单（库存减回）",
    usage: ["wc-cli order return sale void --id N --reason <原因> [--yes]"],
    examples: ["wc-cli order return sale void --id 5 --reason '退错商品' --yes"],
  },
  "order.return.purchase.create": {
    op: "order.return.purchase.create",
    summary: "开进货退货单（**默认预演**；按当前均价出库，需库存充足）",
    usage: [
      "wc-cli order return purchase create --order-id N --items '<JSON 数组>' [--yes]",
      "  --items 每行：orderItemId / quantity / unitPrice；只能退已入库（received）的单",
    ],
    examples: [
      "wc-cli order return purchase create --order-id 27 --items '[{\"orderItemId\":30,\"quantity\":10,\"unitPrice\":18}]'",
      "wc-cli order return purchase create --order-id 27 --items @/tmp/pr.json --yes",
    ],
  },
  "order.return.purchase.void": {
    op: "order.return.purchase.void",
    summary: "作废进货退货单（库存加回）",
    usage: ["wc-cli order return purchase void --id N --reason <原因> [--yes]"],
    examples: ["wc-cli order return purchase void --id 3 --reason '退错批' --yes"],
  },
  "order.sale.void": {
    op: "order.sale.void",
    summary: "作废售卖单（**默认预演**；级联作废自动补货单）",
    usage: ["wc-cli order sale void --id N --reason <原因> [--yes]"],
    examples: [
      "wc-cli order sale void --id 20028 --reason '客户取消'          # 预演：看会冲回多少库存",
      "wc-cli order sale void --id 20028 --reason '客户取消' --yes",
    ],
  },
  "order.purchase.void": {
    op: "order.purchase.void",
    summary: "作废进货单（未入库不碰库存；已入库需库存未被消耗）",
    usage: ["wc-cli order purchase void --id N --reason <原因> [--yes]"],
    examples: ["wc-cli order purchase void --id 27 --reason '开错了' --yes"],
  },
  "order.reopen": {
    op: "order.reopen",
    summary: "改单（作废原单 + 按原单内容重开新单；**默认预演**）",
    usage: [
      "wc-cli order reopen --type sale|purchase --from-id N [--reason 改单原因]",
      "                    [--customer-id N | --supplier-id N] [--remark ...]",
      "                    [--items '<JSON 数组>'] [--yes]",
      "  不给 --items 就照抄原单的行（含原售价/进价），相当于原样重开一张",
      "  --revision-of N：记修订血缘（审核被驳回后重提用它指向旧版）",
    ],
    examples: [
      "wc-cli order reopen --type sale --from-id 20028 --reason '客户换成了张敬玮' --customer-id 2",
      "wc-cli order reopen --type sale --from-id 20028 --reason '按驳回意见改数量' --items '[...]' --revision-of 20028 --yes",
      "wc-cli order reopen --type sale --from-id 20028 --items '[{\"productId\":3,\"quantity\":8,\"unitPrice\":26,\"supplyPrice\":18}]' --yes",
    ],
  },
  "order.estimate.fill": {
    op: "order.estimate.fill",
    summary: "估价补单（**默认预演**；生成待收货进货单 + 成本写回原行 + 补正商品档案）",
    usage: [
      "wc-cli order estimate fill --item-id N --supplier-id N --unit-price 18.00",
      "                          [--product-name 真名] [--category-id N] [--ref-purchase-price 18.00] [--yes]",
      "  --item-id 是估价行 id（query pending-estimates 能看到）",
    ],
    examples: [
      "wc-cli order estimate fill --item-id 20032 --supplier-id 1 --unit-price 18",
      "  ↑ 预演：列出将生成哪张进货单、成本写回多少、商品档案改什么",
      "wc-cli order estimate fill --item-id 20032 --supplier-id 1 --unit-price 18 --product-name 'YJV 5*6' --yes",
    ],
  },
  "review.list": {
    op: "review.list",
    summary: "审核台列表（默认看待审核；可 --needs-void 看已驳回未作废的待办）",
    usage: [
      "wc-cli review list [--status pending_review|approved|rejected] [--doc-type sale_order|...]",
      "                  [--agent-only] [--run <agentRunId>] [--needs-void] [--table]",
      "  也可以直接写 review mine --status rejected（Agent 拉自己的驳回待办）",
    ],
    examples: [
      "wc-cli review list --table                        # 待审核队列",
      "wc-cli review list --agent-only --table           # 只看 Agent 代做的",
      "wc-cli review list --run run-20260914-abc --table # 只看某一次运行的批次",
      "wc-cli review list --needs-void --table           # 已驳回但还没作废的（待办）",
    ],
  },
  "review.show": {
    op: "review.show",
    summary: "看一张单的审核状态与历轮意见",
    usage: ["wc-cli review show --doc-type sale_order --doc-id N [--table]"],
    examples: ["wc-cli review show --doc-type sale_order --doc-id 20028 --table"],
  },
  "review.stats": {
    op: "review.stats",
    summary: "Agent 代做统计（总数 / 待审 / 已通过 / 已驳回），与工作台同一口径",
    usage: ["wc-cli review stats [--table]"],
    examples: [
      "wc-cli review stats --table    # 这批 Agent 单子审到哪一步了",
    ],
  },
  "review.approve": {
    op: "review.approve",
    summary: "审核通过（**仅人类**；Agent 令牌会被拒）",
    usage: ["wc-cli review approve --doc-type sale_order --doc-id N --notes <意见> [--yes]"],
    examples: ["wc-cli review approve --doc-type sale_order --doc-id 20028 --notes '已核对' --yes"],
  },
  "review.reject": {
    op: "review.reject",
    summary: "驳回（**仅人类**；驳回不等于撤销，单据已生效，需另行作废）",
    usage: ["wc-cli review reject --doc-type sale_order --doc-id N --notes <原因> [--yes]"],
    examples: ["wc-cli review reject --doc-type sale_order --doc-id 20028 --notes '数量不对，请改成 5' --yes"],
  },
  "review.comment": {
    op: "review.comment",
    summary: "只留一条意见，不改审核状态（仅人类）",
    usage: ["wc-cli review comment --doc-type sale_order --doc-id N --notes <意见> [--yes]"],
    examples: ["wc-cli review comment --doc-type sale_order --doc-id 20028 --notes '下不为例' --yes"],
  },
  "payment.create": {
    op: "payment.create",
    summary: "登记收付款（**默认预演**；一单一笔）",
    usage: [
      "wc-cli payment create --direction receipt|payment --order-type sale|purchase --order-id N",
      "                      --amount 100.00 [--method cash|bank|wechat|alipay|other]",
      "                      [--remark ...] [--yes]",
    ],
    examples: [
      "wc-cli payment create --direction receipt --order-type sale --order-id 20020 --amount 1000 --method bank",
      "  ↑ 收款：客户付了 1000（预演，不落库）",
      "wc-cli payment create --direction receipt --order-type sale --order-id 20020 --amount 1000 --yes",
      "wc-cli payment create --direction payment --order-type purchase --order-id 22 --amount 500 --yes   # 付厂家",
    ],
  },
  "payment.void": {
    op: "payment.void",
    summary: "作废收付款（冲回已收/已付；错了只能作废不能改）",
    usage: ["wc-cli payment void --id N --reason <原因> [--yes]"],
    examples: ["wc-cli payment void --id 9 --reason '金额填错，重登' --yes"],
  },
  "master.unit.create": {
    op: "master.unit.create",
    summary: "新建单位（**默认预演**；重名拒绝）",
    usage: ["wc-cli master unit create --name <单位名> [--yes]"],
    examples: ["wc-cli master unit create --name 卷", "wc-cli master unit create --name 卷 --yes"],
  },
  "master.unit.update": {
    op: "master.unit.update",
    summary: "重命名单位（必须给 --id）",
    usage: ["wc-cli master unit update --id N --name <单位名> [--yes]"],
    examples: ["wc-cli master unit update --id 3 --name 包 --yes"],
  },
  "master.unit.set-status": {
    op: "master.unit.set-status",
    summary: "启用/停用单位（软删）",
    usage: ["wc-cli master unit set-status --id N --enabled true|false [--yes]"],
    examples: ["wc-cli master unit set-status --id 3 --enabled false --yes"],
  },
  "master.category.create": {
    op: "master.category.create",
    summary: "新建商品分类（**默认预演**；重名拒绝）",
    usage: ["wc-cli master category create --name <分类名> [--yes]"],
    examples: ["wc-cli master category create --name 开关插座 --yes"],
  },
  "master.category.update": {
    op: "master.category.update",
    summary: "重命名商品分类（必须给 --id）",
    usage: ["wc-cli master category update --id N --name <分类名> [--yes]"],
    examples: ["wc-cli master category update --id 2 --name 电线电缆 --yes"],
  },
  "master.category.set-status": {
    op: "master.category.set-status",
    summary: "启用/停用商品分类（软删）",
    usage: ["wc-cli master category set-status --id N --enabled true|false [--yes]"],
    examples: ["wc-cli master category set-status --id 2 --enabled false --yes"],
  },
  "query.audit-logs": {
    op: "query.audit-logs",
    summary: "查审计日志（仅管理员；可按实体/用户/动作筛）",
    usage: [
      "wc-cli query audit-logs [--entity-type product] [--entity-id N] [--username admin]",
      "                        [--action create|update|void|...] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--table]",
    ],
    examples: [
      "wc-cli query audit-logs --table",
      "wc-cli query audit-logs --entity-type product --table    # 商品档案被谁改过",
      "wc-cli query audit-logs --username admin --action create --table",
    ],
  },
};

const VERSION = "0.1.0";

function mainHelp(): string {
  const lines = [
    `wc-cli ${VERSION} — 玮川进销存命令行（默认 JSON 输出，写操作默认 dry-run）`,
    "",
    "用法：wc-cli <命令> [参数] [--json|--table] [--run <批次id>]",
    "",
    "命令：",
  ];
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    lines.push(`  ${name.replace(".", " ").padEnd(22)}${cmd.summary}`);
  }
  lines.push(
    "",
    "环境变量：",
    `  WC_TOKEN     访问令牌（也可写到 ~/.config/weichuan/token）；不要写进命令行参数`,
    `  WC_BASE_URL  服务地址，默认 http://127.0.0.1:3000`,
    "",
    "退出码：0 成功 / 2 参数错 / 3 权限不足 / 4 业务规则拒绝 / 5 冲突 / 1 其他",
    "",
    "示例：",
    ...Object.values(COMMANDS).flatMap((c) => c.examples.map((e) => `  ${e}`)),
  );
  return lines.join("\n");
}

function commandHelp(name: string, cmd: Command): string {
  return [
    `wc-cli ${name.replace(".", " ")} — ${cmd.summary}`,
    "",
    "用法：",
    ...cmd.usage.map((u) => `  ${u}`),
    "",
    "示例：",
    ...cmd.examples.map((e) => `  ${e}`),
  ].join("\n");
}

/**
 * 找出命令名：按"段数从多到少"匹配，这样 `master product create`（三段）
 * 与 `query orders`（两段）、`auth.whoami`（一段）都能落到同一张表上。
 */
function resolveCommand(argv: string[]): { key: string; rest: string[] } | null {
  // 段数从深到浅试，上限取注册表里最深的命令（现在是 order.return.sale.create 四段）。
  // 写死数字会随命令面增长而过期——`order return sale create` 就曾因此报"未知命令"。
  for (let n = Math.min(MAX_DEPTH, argv.length); n >= 1; n--) {
    const key = argv.slice(0, n).join(".");
    if (key in COMMANDS) return { key, rest: argv.slice(n) };
  }
  return null;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(`--${flag}`);
}

function valueOf(args: string[], flag: string): string | undefined {
  const i = args.indexOf(`--${flag}`);
  return i >= 0 ? args[i + 1] : undefined;
}

/**
 * 哪些入参要转成数字：**凡是 Id 结尾的一律转**（productId / orderId / fromId / entityId…），
 * 另加几个分页与数值键。
 *
 * 以前是一张手写白名单，结果每加一个命令都可能漏——`--from-id` 就漏过，
 * 传过去的是字符串、服务端 Prisma 直接抛内部错误。改成规则以后不会再漏。
 */
const NUMERIC_KEYS = new Set(["page", "pageSize", "limit", "amount", "quantity", "unitPrice", "minStock", "refPurchasePrice", "refSalePrice"]);
const isNumericKey = (key: string) => key.endsWith("Id") || NUMERIC_KEYS.has(key);

/** 结构化入参（数组/对象）用 JSON 传；值以 @ 开头则读文件，便于 Agent 生成大数组 */
const JSON_KEYS = new Set(["items"]);

function parseJsonArg(key: string, raw: string): unknown {
  const text = raw.startsWith("@") ? readFileSync(raw.slice(1), "utf8") : raw;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new CliFailure("INVALID", `--${key} 不是合法 JSON：${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * 把 `--page-size 50` / `--starred` 这串参数转成 op 的 input。
 * kebab-case → camelCase（--page-size → pageSize）；
 * 后面紧跟 `--` 开头或已到末尾的，视为布尔 true。
 */
function buildInput(args: string[]): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) continue;
    const key = args[i].slice(2).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    // --json / --table / --help / --run 由 CLI 自己消费，不进 input
    if (key === "json" || key === "table" || key === "help" || key === "run" || key === "yes") continue;
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) {
      input[key] = true;
      continue;
    }
    // 显式写 true/false 就按布尔传（否则服务端拿到的是字符串）；
    // 注意 z.coerce.boolean() 那条坑：字符串 "false" 在 JS 里是真值，见 lib/form-bool.ts
    if (JSON_KEYS.has(key)) input[key] = parseJsonArg(key, next);
    else if (next === "true" || next === "false") input[key] = next === "true";
    else input[key] = isNumericKey(key) ? Number(next) : next;
    i++;
  }
  return input;
}

/** 命令名最深有几段（由注册表推导，避免写死） */
const MAX_DEPTH = Math.max(...Object.keys(COMMANDS).map((k) => k.split(".").length));

/** 把嵌套对象摊平成"点号路径 → 值"，便于两列对齐 */
function flatten(data: Record<string, unknown>, prefix = ""): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(data)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v == null) continue;
    if (Array.isArray(v)) {
      // 数组：基元直接列出，对象只报个数（明细在 --json 里，表格塞不下）
      out.push([key, v.length === 0 ? "（空）" : typeof v[0] === "object" ? `${v.length} 项` : v.map((x) => String(x)).join(", ")]);
    } else if (typeof v === "object") {
      out.push(...flatten(v as Record<string, unknown>, key));
    } else {
      out.push([key, String(v)]);
    }
  }
  return out;
}

/**
 * 列表数据按列对齐输出（`--table` 遇到数组时用这个，一行一条记录）。
 * 只把基元字段当列：嵌套的对象/数组（明细行、按对方汇总）在表格里塞不下，
 * 想看全用 `--json` —— 总比显示一排 [object Object] 强。
 */
function renderRows(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "  （没有符合条件的记录）";
  const cols = Object.keys(rows[0]).filter((c) => {
    const v = rows[0][c];
    return v == null || typeof v !== "object";
  });
  const cells = rows.map((r) => cols.map((c) => (r[c] == null ? "" : String(r[c]))));
  const width = cols.map((c, i) => Math.max(c.length, ...cells.map((row) => row[i].length)));
  const line = (vals: string[]) => "  " + vals.map((v, i) => v.padEnd(width[i])).join("  ");
  const body = [line(cols), line(width.map((w) => "─".repeat(w))), ...cells.map(line)].join("\n");
  const hidden = Object.keys(rows[0]).length - cols.length;
  return hidden > 0 ? `${body}\n  （另有 ${hidden} 个字段是明细/汇总，用 --json 查看）` : body;
}

/** 排成两列给人看（标量数据用） */
function renderTable(data: Record<string, unknown>): string {
  // 列表命令：data.rows 是记录数组 → 逐行成表
  const rows = (data as { rows?: unknown }).rows;
  if (Array.isArray(rows) && rows.length > 0 && typeof rows[0] === "object") {
    const head = flatten(
      Object.fromEntries(Object.entries(data).filter(([k]) => k !== "rows" && k !== "applied"))
    );
    const summary = head.length > 0 ? head.map(([k, v]) => `  ${k.padEnd(12)}  ${v}`).join("\n") + "\n\n" : "";
    const applied = data.applied != null ? "\n\n  生效条件：" + JSON.stringify(data.applied) : "";
    return summary + renderRows(rows as Record<string, unknown>[]) + applied;
  }
  const flat = flatten(data);
  if (flat.length === 0) return "  （无数据）";
  const width = Math.max(...flat.map(([k]) => k.length));
  return flat.map(([k, v]) => `  ${k.padEnd(width)}  ${v}`).join("\n");
}

async function run(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    console.log(mainHelp());
    return 0;
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    console.log(VERSION);
    return 0;
  }

  const resolved = resolveCommand(argv);
  if (!resolved) {
    throw new CliFailure("INVALID", `未知命令：${argv.join(" ")}\n\n${mainHelp()}`);
  }
  const { key, rest } = resolved;
  const cmd = COMMANDS[key];

  if (hasFlag(rest, "help") || rest.includes("-h")) {
    console.log(commandHelp(key, cmd));
    return 0;
  }

  const cfg: CliConfig = loadConfig();
  const asTable = hasFlag(rest, "table");
  const data = await call<Record<string, unknown>>(cfg, {
    op: cmd.op,
    input: buildInput(rest),
    runId: valueOf(rest, "run"),
    // 写操作默认预演；只有 --yes 才让服务端真落库（服务端也会自己兜一层）
    commit: hasFlag(rest, "yes") ? true : undefined,
  });

  if (asTable) {
    console.log(renderTable(data));
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
  return 0;
}

run(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e: unknown) => {
    if (e instanceof CliFailure) {
      console.error(`错误：${e.message}`);
      process.exitCode = exitCodeOf(e.code);
      return;
    }
    console.error(`未预期的错误：${e instanceof Error ? e.stack : String(e)}`);
    process.exitCode = 1;
  });
