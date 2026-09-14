# ERP Agent CLI：已核实版实施方案（v2）

> 状态：**Phase 0 调查补全已完成**（2026-09-14）。本文取代 v1 调查稿，可直接作为实施依据。
>
> **标注约定**
> - ✅ **已核实（本会话复现）**：主智能体亲自读了代码/配置并确认，给 `file:line`。
> - ✅ **已核实（报告 NN）**：Phase 0 子智能体核实，明细在 `docs/research/NN-*.md`，含 `file:line`。
> - ❌ **与事实不符**：v1 调查稿的说法被证伪，已改正。
> - ⚠️ **待核实**：确认为空白，动手前必须先查（不要当成已核实）。
>
> 调查报告索引：`docs/research/00-索引.md`（8 份报告，3459 行明细）。
>
> **本次调查的意外收获**：在核实"待核实项"的过程中发现 **3 个已上线缺陷**（1 个 P0 功能整体失效、
> 1 个 P0 必然失败、1 个静默数据损坏），以及一批口径分叉。详见 **§3.5 先修清单**——这些必须在
> CLI 复用它之前修掉，否则 CLI 会把 bug 一起放大。

---

## 0. 一句话目标

给这套进销存做一套 **CLI**，让 Agent（或脚本、cron）能像人一样完成"该有的功能"：查数据、开单、作废/改单、入库、退货、收付款、补估价单、维护主数据、导出报表。**关键约束：CLI 必须复用现有业务逻辑，不得绕过去直接写库。**

---

## 1. 技术栈与运行形态（✅ 已核实（本会话复现））

- Next.js **16.3.4** App Router（`output: "standalone"`，`next.config.ts:22`）+ React 19.2.8 + Tailwind v4。
- Prisma **6.19.3** + MySQL 8.4；zod 4.5.4；`@node-rs/argon2` 哈希；exceljs 导出；pinyin-pro **仅服务端**。
- **认证是自建 cookie 会话，不是 NextAuth**：`src/lib/auth/session.ts`
  - Cookie 名 `weichuan_session`，值 = 32 字节随机 hex；DB 只存 `sha256(token)`（`session.ts:13,45-50`）；
  - 有效期 **8 小时**（`session.ts:17`）；HttpOnly + SameSite=Lax + 仅实际 HTTPS 时加 Secure（`session.ts:31-39`）；
  - 已有 `Session` 模型（`prisma/schema.prisma:114-125`）——**这是 `ApiToken` 的现成模板**，见 §6.2。
- **没有 `middleware.ts`**（✅ 本会话确认仓库根与 `src/` 下都没有）：**没有任何路由级统一鉴权**，
  鉴权散落在每个 page 与每个 action 里。CLI/端点层必须自己保证每一次调用都过 guard。
- 业务逻辑全在 **Server Actions**：15 个 `*/actions.ts` + 2 个 `new/search-actions.ts`，共 4053 行。
- **`"server-only"` 是 CLI 的硬门槛**：`audit.ts:1`、`auth/session.ts:1`、`request-ip.ts:1`、
  `auth/login-throttle.ts:1` 都 `import "server-only"`，`guards.ts` 经 `session.ts` 传递依赖。
  进程外用 tsx `import` 这些模块会**直接抛错**（报告 07 实测）。→ 直接决定了架构选择，见 §6.4。
  - 项目里已有正面先例：`pinyin-server.ts:8-10` 明确写了"**不用 server-only 是因为 tsx 跑的测试与回填脚本也要 import 这个模块**"。抽服务层时沿用这个思路。
- **dev 与 prod 的数据库拓扑完全不同**（✅ 本会话确认）：
  - dev：`scripts/db-start.sh` 直接在**宿主机**起 `mysqld --port=3307`（非 Docker）→ 宿主机进程能连。
  - prod：`docker-compose.yml` 的 `mysql` 服务**没有 `ports:` 映射**，只有容器内 `mysql:3306`
    → **宿主机上的 CLI 进程连不上生产库**。
- dev 环境变量只有 `DATABASE_URL`（`.env`）；`.env.example` 只有 `ADMIN_INIT_PASSWORD`。
  完整变量清单（10 个名）见报告 07 §1。

---

## 2. 路由清单（✅ 已核实（本会话复现，已修正 v1 的错误））

**❌ v1 的错误**：v1 把一批"重定向死桩"当成了活路由。实际 `/suppliers`、`/units`、`/categories`
全部 `redirect("/products")`，`/customer-groups`、`/customer-tags`（及 `/suppliers/[id]`）全部
`redirect("/customers")`——见各自 `page.tsx:6-7` 的注释"旧路由保留重定向，避免书签失效"。
CLI 命令面不要按这些旧路由设计（见 §7）。

**开单**：`/sale-orders/new`、`/purchase-orders/new`、`/sale-returns/new`、`/purchase-returns/new`
**单据**：`/sale-orders`、`/sale-orders/[id]`、`/sale-orders/[id]/print`、`/purchase-orders`、`/purchase-orders/[id]`、`/sale-returns`、`/purchase-returns`
**主数据**：`/products`（商品+厂家+单位+分类四个折叠区，见报告 04 §2）、`/products/new`、`/products/[id]`、`/customers`（客户+分组+标签，`?tab=groups|tags`）、`/customers/new`、`/customers/[id]`、`/customers/groups/new`、`/customers/tags/new`
**库存与分析**：`/inventory`、`/stock-movements`、`/receivables-payables`、`/payments`、`/sales-analysis`、`/price-analysis`、`/reports`、`/reports/export`、`/supplier-statement`、`/customer-profile`、`/dashboard`
**待办**：`/pending-estimates`、`/drafts`（**纯客户端 localStorage，服务端无数据源**，见 §7）
**系统**：`/users`、`/users/new`、`/audit-logs`、`/login-logs`、`/backups`、`/backups/download`、`/profile`、`/login`、`/api/health`
**死桩（重定向）**：`/suppliers`→`/products`、`/units`→`/products`、`/categories`→`/products`、`/customer-groups`→`/customers`、`/customer-tags`→`/customers`、`/suppliers/[id]`→`/products`

---

## 3. 业务不变量（✅ 已核实，逐条改写）

v1 的 6 条**基本方向对，但细节有实质出入**。以下是核实后的准确表述：

1. **移动加权成本按单据快照**（✅ 成立，本会话复现）
   成本快照落在 `sale_order_items.cost_amount`（`schema.prisma:422`），开单事务内**一次写定**
   （`sale-orders/actions.ts:457-470`），公式 = 库存部分成本（扣减**前**的移动加权价）+ 现场进货部分成本（现场进价）
   （`actions.ts:332,456-459`）。
   **唯一允许回改它的地方是估价补单**（`pending-estimates/actions.ts:116`）——合理，因为估价行当初没参与过成本。
   **作废不回改快照**（`sale-orders/actions.ts` 的 void 分支）。
   移动加权公式在 `src/lib/stock-cost.ts:50-52` 的 `applyStockChange`。

2. **估价行不占库存、不参与成本、不自动进货**（✅ 服务端逻辑成立，但**落库漏了标志 → 功能整体失效**）
   字段：`saleOrderItem.estimated / estimatedResolvedAt / estimatedPurchaseOrderId`（`schema.prisma:431-435`）。
   开单时三个量都正确归零（`sale-orders/actions.ts:269-271`，`estimated ? 0 : …`）。
   **但创建行时没把 `estimated` 写进去**（`:475-487`）→ 永远落 `false`（schema 默认值）
   → `/pending-estimates` 的查询条件 `{estimated:true}` 永远查不到（`pending-estimates/page.tsx:36`），
   补单入口第一行就 `return { error: "这一行不是估价行" }`（`pending-estimates/actions.ts:63`）。
   **整条"估价 → 待补 → 补单回写成本"闭环在生产上不可达。** 见 §3.5 P0-1。

3. **估价行没有"改成普通行"的操作**（✅ 成立）：单向标记，本轮刚改成只显示静态标记。

4. **"库存只能通过确认入库进来"**（⚠️ **表述需修正**）
   - **手工进货单**：确实"创建 ≠ 入库"，需显式确认（成立）。
   - **但在售卖单里触发的自动补货进货单，是在同一个事务内直接入库的**（`sale-orders/actions.ts` 内自动补货分支）。
   所以准确表述是："**独立创建的进货单必须显式确认入库；售卖单派生的补货进货单在同事务内即刻入库**"。

5. **退货需冲减**（✅ 成立，且方式是**读取时动态冲减**，v1 猜错了机制）
   - 退货**不回写原单、不重算成本快照**；应收应付口径是 `单据总额 − received/paid_amount − Σ未作废退货单`
     （四处 SQL 见报告 03 §4）。
   - **售卖退货**按**原单快照均价**（`costAmount/quantity`）回补库存（`sale-returns/actions.ts:105,142`）。
   - **进货退货**按**当前移动加权均价**出库（`purchase-returns/actions.ts:136`）——两者取数口径不同，做 dry-run 预告金额时要分开算。
   - ⚠️ 代价：作废售卖单时"冲回"用的是**当前**均价，与当初扣出时的均价不等 → **库存金额账不平**（报告 02）。

6. **审计**（✅ 覆盖度比预期高，但有静默丢失路径）
   全库 **74 处 `writeAudit`**，覆盖全部写 action（报告 06 §5）。缺失项只有：备份轮转删除、备份下载、
   脚本路径，以及一个因 `BigInt()` 抛错被吞掉的（§3.5 P1-1）。
   `writeAudit` 的签名与实现对 CLI 是**硬约束**：它依赖 `headers()`（`audit.ts:28-33`），
   进程外调用会抛错并被 `catch` 吞掉（`audit.ts:46-49`）→ **审计静默丢失**。见 §6.4。

---

## 3.5 缺陷清单与修复状态

CLI 的价值前提是"复用同一份业务逻辑"。如果被复用的逻辑本身是坏的，CLI 只会把错误放大到机器速度。
以下缺陷都是 Phase 0 调查发现的，**与 CLI 无关、独立该修**。

> **状态：P0-1 / P0-2 / P1-3 已于 2026-09-14 修复**（作者：Agent，经用户授权），
> 并做了只读连库诊断，见 §3.6。其余项待排期。

### P0（功能不可用 / 必然失败）—— ✅ 已修复

| # | 缺陷 | 证据 | 影响 | 修复 |
|---|---|---|---|---|
| **P0-1** | 开单时 `estimated` 没写进 `saleOrderItem.create` | `sale-orders/actions.ts:301,468` 算了 `estimated`，但 create 没传；同处漏传行级 `unitId`（用了商品默认单位，丢弃了 `it.unitId`） | 「估价待补」整条闭环不可达（§3 第 2 条）：估价行永远不是估价行，待补页空、补单被拒 | ✅ 补 `estimated: r.estimated`；`rowsItem` 增加 `unitId` 并改写 `unitId: r.unitId`（`itemSchema.unitId` 的注释本就写明"不传就用商品的单位"）。`SearchSelect` 每行只渲染一个同名字段（`search-select.tsx:214` 单个 hidden input），故取值确定、无歧义。**另修提交前预检**（`:169-182`）漏豁免估价行的问题——见下方 P0-1b |
| **P0-2** | 进货退货单号**查错表** | `purchase-returns/actions.ts:107` 用 `tx.purchaseOrder.findMany` 却按 `PRF` 前缀过滤（进货单前缀是 `PO`）→ 恒查 0 行 → `maxSeq` 恒为 0 → 单号恒为 `PRF<今日>-0001`；`orderNo` 是 `@unique` → **当日第 2 张必撞唯一约束**，3 次重试耗尽后失败 | 进货退货每天只能开 1 张。对比：售卖退货查 `tx.saleReturn`，正确 | ✅ 改为 `tx.purchaseReturn.findMany`。⚠️ 尚未做"同一天连开两张"的端到端验证（需经 UI） |

| **P0-1b** | 同一个估价流程的**第二个拦路者**（P0-1 修完后由 UI 实测暴露） | `sale-orders/actions.ts:169-182` 的**提交前预检**：对所有"库存不足"的行强制要求补货厂家，**没有豁免估价行** → 估价行被误判"缺货且无厂家"，提交直接失败。而估价行的补货量在后面的计划逻辑（`:270-272`）里本就被归零 | 「估价待补」即使修好 `estimated` 落库也**无法提交**（两个缺陷叠加，只修一个仍然不可用） | ✅ 预检里加 `if (it.estimated) continue;` —— 估价行不占库存也不补货，自然不需要补货厂家 |

### P1（静默数据损坏 / 口径分叉）

| # | 缺陷 | 证据 | 影响 | 状态 |
|---|---|---|---|---|
| **P1-3** | `/products/[id]` 编辑**清零参考售价** | 该页表单字段只有 name/manufacturer/categoryId/unitId/refPurchasePrice/minStock，**没有 `refSalePrice`**；而 `saveProductAction` 读 `formData.get("refSalePrice") ?? 0` 且 schema `default(0)`（`products/actions.ts:18,36,119`）→ 从详情页保存一次即变 0（列表页编辑有该字段，不受影响） | 静默数据损坏 | ✅ 补上 `refSalePrice` 字段与 `initial` 值。⚠️ 残留：**若调用方不传该字段，服务端仍写 0**，所以将来的 CLI/服务层必须显式传它（建议在服务层改成必填） |
| **P1-1** | 备份配置保存**无审计** | `backups/actions.ts:64` 传 `entityId:"backup-config"` → `audit.ts:40` 的 `BigInt()` 抛错 → 被 `:46-49` 吞掉 | 备份配置变更完全无痕 | ✅ **已修复**：`AuditLog` 新增 `entity_key` 列，字符串标识落这一列；实测 `"backup-config"` 正确入库 |
| **P1-2** | 审计在无请求上下文时静默丢失 | `audit.ts`：`ip === null` 时调 `headers()`，进程外抛错 → 被吞 | 任何非 Next 请求上下文的写操作审计丢失 | ✅ **已修复**：`headers()` 用 try/catch 守住，取不到 IP 就记 null、审计照写；`ip` 也可显式注入 |
| **P1-7** | 3 处 `writeAudit` 写在 `$transaction` 内却用全局 `prisma` | 报告 06 §5 | 审计不参与事务：业务回滚后审计残留；P2002 重试还会写多条 | ✅ **已修复**：`writeAudit` 新增 `tx` 参数，3 处补上；实测"事务回滚后审计一并回滚" |
| **P1-4** | 工作台应收/应付 与 应收应付页**口径不等** | `dashboard/page.tsx` 缺 `GREATEST(...,0)` 且无时间范围；`receivables-payables/page.tsx` 有 | 有超收/超退时两数必然不等 | ✅ **已修复**：工作台补上 `GREATEST`（时间范围不同是有意的，见 §13.8 #1）。实测 dev 库应收 ¥940.19 → ¥3440.19（差额正是那张超退单的 −¥2500） |
| **P1-5** | `/inventory` 的 `warnOnly` 与"预警 N 个"在**分页之后**用 JS 过滤 | `inventory/page.tsx:169-184`：对已 `take` 的当前页做 `.filter()` | 预警数随分页变化；开启 warnOnly 后显示不满一页 | 待修（建议按 §13.9 B9 下推 SQL） |
| **P1-6** | 作废售卖单**不校验已确认退货** | `sale-orders/actions.ts` 作废分支 | 已部分退货的单再作废 → 按整单回补库存，**多补** | ✅ **已修复**：有确认退货时直接拒绝作废，并列出退货单号、提示先作废退货或改用改单（静默把库存补错比报错危险得多） |
| **P1-8** | 估价行在**作废/退货**路径上被当普通行处理（新发现） | 售卖单作废按 `item.quantity` 回补库存、未区分估价行；售卖退货无条件入库 | 作废含估价行的单会**凭空造库存**；估价行退货会凭空入库并按 0 成本拉低均价 | ✅ **已修复**：三处统一跳过估价行（退货入库、作废退货、作废售卖单），并让成功提示如实区分"库存已减回/本就不涉及库存"。⚠️ 待界面点一次确认 |
| **P1-7** | 3 处 `writeAudit` 写在 `$transaction` 内却用全局 `prisma` | 报告 06 §5 | 审计不参与事务：业务回滚后审计残留 | 待修（§13.6） |

### P2（口径不一致 / 隐患）

- `price-analysis.ts:102-103`：`take:3000` 配 `orderBy: asc` 取的是**最旧的** 3000 笔，页面文案却写"最近"（报告 05）。
- ~~**报表完全不排除估价行**~~ ✅ **已处置**：按 §13.8 #4，销售额含估价行，但汇总表会标注「⚠ 其中 N 行估价待补（成本未计，毛利偏高）」，不静默扣减。
- ~~**销售额/毛利口径不冲减退货**~~ ✅ **已处置**：按 §13.8 #3，毛额保留为既有口径，另加净额行。做这件事时又抓到一个真 bug：
  **退货冲减必须排除「原售卖单已作废」的退货**——那种退货已无销售额可冲减，计进来会把净额压成负数。
  dev 数据实证：修复前净额 −¥1090.51，修复后 +¥109.52（3 张原单作废的退货共 ¥120,003.20 被单独标出）。
- **CLI 时间显示踩过一次时区陷阱**：`toISOString().slice(0,10)` 会把本地 9/1 零点显示成 8/31（+08:00 下的 UTC 偏移）。
  已改为本地时区格式化，并在代码里留了注释（§13.8 #2 的同类问题）。
- 超退/重复提交只靠事务外读判断，无唯一约束兜底（报告 02、03）。**已在 dev 复现超退**（§3.6）。
- 状态类校验都在事务外 → 可双次作废、双次入库、重复开补单（报告 02）。

---

## 3.6 只读连库诊断结果（2026-09-14）

**范围与限制**：连的是**本机 dev 库**（`.mysql` 实例，127.0.0.1:3307）。
**生产库无法从本机连**——`docker-compose.yml` 的 mysql 服务没有 `ports` 映射（报告 07 §2），
所以生产的数据形态仍然未知。dev 数据规模很小（售卖单 16、进货单 19、售卖退货 4、进货退货 0、商品 21、单据行 19），
属于"种子级"数据，**结论不能直接外推到生产**。

| 缺陷 | 诊断结果 | 结论 |
|---|---|---|
| **P0-1 估价标志** | `sale_order_items` 共 19 行，`estimated=true` **0 行**；也没有"疑似估价行"（`cost_amount=0 且 stock_qty_used=0 且数量>0`）——0 行 | 代码缺陷确凿，但 **dev 里从未有人用过估价行**，所以无数据损坏。修复后该功能才第一次真正可用。<br>**⚠️ 修复后 UI 实测立刻发现 P0-1b**（预检漏豁免估价行）：说明这个功能是"多个缺陷叠加"，**只修代码不跑 UI 会误判为已修好** —— 这正是本节待办 1 的价值 |
| **P0-2 进货退货单号** | `purchase_orders` 共 **19 行，全部 `PO` 前缀**，其中匹配 `PRF<今日>-%` 的是 **0 行**；`purchase_returns` 总数 **0** | 缺陷机制被直接证明（旧查询**结构上不可能**命中）。因 dev 一张进货退货单都没有，故从未触发。对照：售卖退货 4 张、其中一天开了 3 张 → "一天多张退货"是常态业务，进货侧一旦用起来第 2 张就会炸 |
| **P1-3 参考售价清零** | `products` 21 个**全部** `ref_sale_price=0`；其中 10 个 `ref_purchase_price>0`；9 个"售价为 0 却按正价卖过"。**但 `audit_logs` 里 `product/update` 审计数为 0** | **既未复现也未排除**：dev 从未编辑过商品，无法区分"从没填过参考售价"与"被清零"。真正的暴露面在生产 |
| **P1-4 两处口径不等** | 工作台口径（无 `GREATEST`）＝ **88560**，应收应付页口径（有）＝ **338560**，差额 **250000** | ✅ **已在 dev 复现**。源头是单据 `SO20260912-0008`：单额 500000、已收 0、确认退货合计 750000 → 未结 **-250000**（正是被 `GREATEST` 夹掉的那笔） |
| **库存健康度** | 负库存 0、负金额 0、数量为 0 但金额非 0 的 0 | 干净 |
| **超退（新发现）** | 上条那张退货单 `PRS20260912-0001` 金额 **750000 > 原单 500000** | ⚠️ **退货金额可以超过原单总额**已被真实数据证实（报告 03 只从代码推断"超退仅靠事务外读判断""无唯一约束兜底"）。这条从 P2 隐患升级为**已发生**，应连同 P1-6 一起定口径 |

**由此产生的两个待办**：
1. P0-1 与 P0-2 都**只做了代码修复与静态/结构验证**，缺"经 UI 的真实端到端"：
   P0-1 需要开一张带估价行的售卖单 → 看它出现在 `/pending-estimates` 并能补单；
   P0-2 需要同一天连开两张进货退货单 → 单号应为 `-0001`、`-0002`。
2. dev 库是种子数据，**生产是否有存量损坏（估价行、超退、参考售价被清零）仍待查**——需要有人在能连生产库的机器上跑一遍同样的只读查询。

---

## 4. 角色与权限（✅ 已核实 — ❌ v1 多处推测被证伪）

**角色枚举实际只有 3 个**：`admin`（管理员）/ `sales`（业务员）/ `boss`（老板/财务）
（`schema.prisma:90` + `src/lib/auth/roles.ts:3-7`）。

**`guards.ts` 实际只有 3 个 guard**（✅ 本会话读了全文 `src/lib/auth/guards.ts`），全部 `throw`：

| guard | 判定条件 | 失败 |
|---|---|---|
| `requireAdmin()` | `!user \|\| user.role !== "admin"` | `throw new Error("无权限执行此操作")`（`:9-15`） |
| `requireMasterDataWrite()` | `!user` → 抛"未登录"；`role !== "admin"` → 抛"基础资料仅管理员可维护" | `throw`（`:18-25`） |
| `requireLogin()` | 仅要求 `user` 存在 | `throw new Error("未登录")`（`:28-32`） |

**❌ v1 的错误**：v1 §4 写的 `requireUser`、`requirePurchaseUser` **不存在**。
所谓 `requirePurchaseUser` 其实是 `purchase-orders/new/search-actions.ts:36` 的**局部函数**，不是通用 guard。
另外 v1 推测"`sales` 看不到成本（`canSeeCost = role !== "sales"`）"**不成立**：
实际上 `/inventory`、`/products` 对 `sales` **也展示成本**（报告 06 §4）。完整"角色 × 能力"矩阵见
**报告 06 §4**（逐格带 `file:line`），实施 Phase 1 时以那份表格为准，不要用 v1 的推测。

**`boss` 的受限范围比 v1 写的大**：开单、退货、确认入库全部被拒（报告 06 §4）。

---

## 5. 机器可读出口的现状（✅ 已核实，v1 结论成立）

- 业务数据**没有 JSON API**；机器可读出口只有两个：
  - `/reports/export`（exceljs，6 个报表 tab）；鉴权仅"已登录且非 sales"，导出全量且**不写审计**（报告 05 §4）。
  - `/api/health`（检查 DB + 备份新鲜度，只看 `.gpg`）。
- **结论不变**：CLI 要"查一切"，必须新增结构化输出层。

---

## 5.5 Agent 溯源（✅ 已核实落地约束）

**目标**：统计与列表里能一眼看出哪些是 Agent 代做的、哪些是人做的、是哪个 Agent（哪次运行）做的。

**已核实的现状**（这决定了要加多少列）：
- `User` 模型**没有** `isAgent` 之类字段；`AuditLog` **没有** `actorKind` / `agentRunId` / `apiTokenId`
  （报告 06 §5）；`UserRole` 只有 3 个值（§4）。
- 所以 v1 的方案（业务表加列 + `ActorKind{human,agent}` + `agentRunId` + `apiTokenId`）**方向正确，且必须新建**，
  没有现成字段可复用。

**结论**：按 v1 设计执行，直接在各业务表加列（不建影子表）；`AuditLog` 也要加
`actorKind` / `agentRunId` / `apiTokenId`；`ApiToken` 的 `scopes` 是"Agent 不能自审自批"的唯一可靠载体（§5.6）。
原则不变：**Agent 必须诚实标注自己**，由服务层统一写入，CLI 无法绕过。

---

## 5.6 审核流（✅ 已决策：立刻生效 + 覆盖 5 类单据）

审核是**独立维度**（`reviewStatus`），不塞进现有业务状态（`pending`/`received`/`confirmed`/`voided`），
否则两套状态会互相打架 —— 这个判断成立，因为现有状态字段语义已被成本/入库逻辑占用。

```
Agent 建单 ──► 立刻生效（库存/成本当场变动）──► 待审核 pending_review
                                                    │
                          ┌─────────────────────────┼──────────────────────────┐
                          ▼                         ▼                          ▼
                    已通过 approved            已驳回 rejected            （人类单据）
                    （或 not_required）        → 必须作废（见下）        reviewStatus = not_required

人 建单 ──► 无需审核（reviewStatus = not_required，行为与今天完全一致）
```

### 生效时机：**立刻生效、留痕在后**（✅ 已决策，§12 A3）

Agent 建单即生效——库存、成本快照、流水、补货单都在创建事务里照常产生，**与人工建单的行为完全一样**。
审核是**事后复核 + 留痕 + 追责**，不是把关闸门。

**这个选择有三个必然推论，必须一起设计，否则会出错：**

1. **"驳回"不等于"撤销"。** 被驳回的单据此刻**已经改过库存、动过成本快照**，而按不变量 1（§3 第 1 条）
   成本快照不能回溯改。这个项目里**唯一能让单据退出库存/成本账的手段是「作废」（void）**。
   → 所以**驳回必须绑定"待作废"**：审核台要有「已驳回但未作废」的待办视图，
   驳回时的意见要明确写"请作废该单"或由人直接作废。否则驳回只是打了个标，库存还挂在账上。
   （代价要说清：作废按**当前**均价冲回，与当初扣出时不等 → 库存金额会留下扰动，报告 01/02 已实证。）

2. **`revise` 必须自动作废旧版**，否则新旧两版**同时生效**，库存与成本被重复计入。
   → 实现上**直接复用 `order reopen`**（作废原单 + 用原单内容重开），`revisionOf` 记血缘、`version` 递增。
   这正是 §7 里"改单需要一个真正的服务层入口"的复用点：`reopen` 与 `revise` 是同一机制、
   只是账本字段不同。⚠️ 反复 revise 会反复按当前均价冲回/重算，多次循环后移动加权成本会逐步漂移。

3. **统计口径要分两层**：
   - **库存 / 成本 / 流水口径必须包含所有已生效单据**（含 `pending_review` 与 `rejected`）——
     否则报表与物理库存对不上，那是更严重的错。
   - **业绩类统计**（销售额、排行、业绩）把 `rejected` 单独一行或排除，让"没被认可的业务"看得见。
   - 因为推论 1 要求驳回后作废，正常情况下业务口径里不会长期留 `rejected` 单；
     审核台的"待作废"待办就是保证这一点不腐化。

**因这个决策而简化的部分（原先按"把关在前"准备的工作可以不做）**：
不需要把"建单"与"生效"拆成 `createX` / `applyX` 两个函数，不需要"可延后调用的副作用函数"，
**Phase 2.5 与 Phase 3 也就不必合并排期**（合并的理由是那个拆分）；
§13.4 原先设计的"生效过滤唯一入口"同样不再需要（所有单都生效）。

**仍然需要的 schema 工作**：`reviewStatus`（默认 `not_required`，保护历史与人工流程）
+ `reviewedBy`/`reviewedAt`/`version`/`revisionOf` + `ReviewNote`（多轮意见留痕）
+ 溯源列 `actorKind`/`agentRunId`/`apiTokenId`/`operatorUserId` + `AuditLog` 同类列。

**关于"留痕在后不阻止错误"这个代价：不加熔断（✅ 已决策）**
理由（决策人给的）：出问题后可以**快速作废/改单**补救，没必要为此让 Agent 的单停在人工确认上。
因此**不要再提"超阈值熔断"这个方案**。剩下唯一的安全网就是推论 1 的「已驳回但未作废」待办 ——
这也意味着**那个待办视图必须显眼、且有人真的会看**，它是整套设计里最后一道人工环节。

需要如实记下的残余风险（不是反对这个决策，而是别让它被忘掉）：
"快速改单/作废"**不是一次完美撤销**——作废按**当前**均价冲回，与当初扣出时不等，
所以每次补救都会在库存金额上留下一点扰动（报告 01/02 实证）；
错单发现得越晚、中间又发生过入库/出库，扰动越大。推论 2 已把这层代价写进 `revise` 的说明。

**覆盖范围：5 类单据**（✅ 已决策，§12 A4）
`docType: sale_order | purchase_order | sale_return | purchase_return | payment`，`ReviewNote.docType` 复用同一枚举。
退货写库存、付款动应收应付，都属于"仅次于开单"的业务事实，必须与开单一起被复核。
它们同样是**立刻生效**（退货照常冲减、付款照常 `increment`），
被驳回时同样适用推论 1：**付款只能作废不能修改**（报告 03 §3），所以驳回 → 作废收付款。

**驳回意见与多轮修改**：`ReviewNote { id, docType, docId, round, verdict(approve|reject|comment), notes, reviewerUserId, createdAt }`
——全过程留痕、可多轮、旧版永久保留为「已驳回」（不删除；其库存/成本影响由推论 1 的作废处理）。
Agent `revise` 时基于被驳回那版生成**新版本**（`revisionOf` 指向旧版、`version` 递增，并自动作废旧版）；
每次重提必须在 `--json` 输出里**逐条回应上一轮审核意见**。

**权限（职责分离，硬约束）**
- 审核只能由**人**做（admin / boss）；Agent token 不含 review 权限，越权直接拒绝并写审计。
- **已核实的落地载体**：`ApiToken.scopes`（因为 `User` 没有 isAgent、`UserRole` 只有 3 值，无法靠角色区分）。
- Agent 自助拉取待办：`wc-cli review mine --status rejected` → 拿意见 → 改 → 重提；这正是
  "我提需求 → AI 干掉 → 我审核 → AI 按意见再改"的闭环。

**界面**：新增审核台（按类型/时间/`agentRunId` 批次分组，批量通过/驳回 + 填意见），
**含「已驳回但未作废」待办视图**（推论 1 的落点）；列表与详情给单据打来源与审核状态角标；
工作台/报表给 `rejected` 单单独一行，不与已认可业务混在一起。

---

## 5.7 Agent 工作协议：不打断人（维持 v1，补一条已核实约束）

- **默认自主推进**：能推断的按最合理假设往下做、**不中途提问**；把"假设 + 不确定处"写进单据的
  `reviewNotes`（连同 dry-run 摘要），**在审核环节一次性呈现给人**。
- 只在两种情况停下并说明"为什么停、需要人做什么"：① 需要不可逆且超出授权的操作（删历史、恢复备份）；
  ② 业务规则明确禁止（如状态不允许作废）。
- 落库前先给 dry-run 摘要（改哪些表、影响哪些单据/数量/金额）；人核准的对象是**待审核单据**，不是过程中每一步。
- 一次需求 = 一个 `agentRunId` = 一批单据，审核页按批次整体过。
- **补充（已核实）**：dry-run 的金额预告要按后面 §7 的口径算，注意**售卖退货按原单快照均价、
  进货退货按当前加权均价**（§3 第 5 条），两者不同。

---

## 6. CLI 的核心设计决策（**架构已修订**）

### 6.1 复用逻辑的做法（❌ v1 的"推荐 C：CLI 直连服务层"在生产不可行）

v1 的 A/B/C 三分法分析正确（A 拿不到请求上下文、B 依赖 Server Action 内部 action id 不稳定），
但 **C 的落地方式被本次调查证伪**：CLI 进程**无法**直接 `import` 服务层：

1. `"server-only"` 硬门槛：`audit.ts:1`、`auth/session.ts:1`、`request-ip.ts:1`、`auth/login-throttle.ts:1`
   在 tsx 下 import 即抛错（报告 07 实测）。服务层必然要用审计与身份，绕不开。
2. **生产 MySQL 没有宿主端口映射**（`docker-compose.yml`）：宿主机 CLI 连不上库。
3. 生产镜像**不含 `src/`**（`Dockerfile`，standalone 输出）→ 容器内 tsx 也跑不了源码。

**修订后的方案（推荐 C′）**：

> **服务层仍然是唯一逻辑源；CLI 通过一层极薄的 HTTP 端点访问它。**

- 抽 `src/lib/services/*`，函数签名统一 `(actor: { id, role, actorKind, agentRunId?, apiTokenId?, scopes? }, input: T) => Promise<Result>`，
  内部自己 zod 校验 + 权限断言 + 事务 + 审计。**服务层不 `import "server-only"`**（沿用 `pinyin-server.ts:8-10` 的先例），
  由调用它的 Server Action / 端点承担"只在服务端执行"的约束。
- Server Action 变薄壳（鉴权 + 调服务层 + `revalidatePath`），**对外契约不变**。
- 新增 `/api/cli/*` 路由：解析 `Authorization: Bearer <token>` → 调服务层 → 统一 JSON 契约与退出码语义。
  CLI 是纯 HTTP 客户端（`fetch`），不碰 Prisma、不碰 `server-only`。

**收益**：逻辑只有一份（满足 v1 的核心诉求）；dev 与 prod 都能跑；鉴权/审计/`headers()` 都在原生上下文里，
`writeAudit` 的 `headers()` 依赖（§3）不再是问题。**代价**：要接受"新增最小端点层"（推翻了 v1 §6.4）。

### 6.2 CLI 怎么鉴权（✅ 现状已核实：**没有任何 token / API key 机制**）

- 「现状是 cookie 会话 + 无 token 机制」**成立**（✅ grep 全仓 0 命中 `Authorization`/API key/签名 URL）。
- **CLI 不能复用 cookie**：cookie 只能被 Server Action 的 POST 携带（带内部 action id，不稳定），
  而且会话身份里**没有"Agent 是哪一次运行"这一维**，无法满足 §5.5/§5.6。
- **`ApiToken` 的现成模板就是 `Session`**（`schema.prisma:114-125`）：只存 `sha256` 哈希、有 `expiresAt`、
  登出即删行。按同样的模式设计：
  `ApiToken { id / userId / tokenHash(sha256) / name / scopes / expiresAt / lastUsedAt / revokedAt }`。
- `requireUserFromToken(token)` guard：解析 → 校验有效期/吊销 → 返回 `{ id, role, scopes }`；
  **它是服务层之外的适配器**，与 cookie 版 guard 并存。
- CLI 从环境变量 `WC_TOKEN` 或 `~/.config/weichuan/token` 读取；**绝不把 token 写进命令行参数**
  （会进 shell 历史与进程列表）。
- 发 token：`wc-cli auth token create --user <username> --expires 90d`（本地受信执行，或网页管理页生成）。
- 所有 CLI 调用写审计（`actor=token名` + `apiTokenId`），并限流。
  **注意（已核实）**：现有节流是"库表计数"（`login_logs`，账号 5 次/15 分钟、IP 20 次/5 分钟，
  `login-throttle.ts` + `session.ts:19-20`），**不能直接承载 token 限流**，需要另设（报告 06 §7）。

### 6.3 安全约束（维持 v1）

- **默认只读**：写操作必须显式 `--yes`（或 `--commit`）才落库；默认 `--dry-run` 打印"将要做什么 + 影响范围"。
- 破坏性操作二次确认：`--confirm <单号>` 显式回执。
- 全部写操作走服务层 → 自动获得权限校验与审计。
- 输出默认 `--json`；`--table` 给人看。
- 退出码规范化：`0` 成功、`2` 参数错、`3` 权限不足、`4` 业务规则拒绝、`5` 冲突/并发。
- 金额与数量一律用字符串/Decimal（库里全是 `Decimal`，**无 Float**，✅ 报告 01），时间统一 `YYYY-MM-DD`（本地时区）。

### 6.4 要不要新增 JSON 端点（❌ v1 说"先不加"，**修订为：要加，而且是最小的一层**）

v1 的结论"CLI 直连服务层即可，先不加端点"基于"进程内直连可行"的假设，而该假设已被证伪（§6.1）。
**修订**：加 `/api/cli/*`，但**只做传输与鉴权适配，不放业务逻辑**——这样"同一层逻辑、一次投入两处受益"
的收益仍然成立，且未来真要给第三方对接时直接复用。

---

## 7. 命令面（✅ 已按调查结果修订）

v1 草案里有一批命令**不可实现或指向死路由**，修订如下：

```
wc-cli auth      login/logout/token create|list|revoke/whoami
wc-cli query     orders|order|returns|inventory|movements|payments|receivables|payables
                 customers|products|units|categories|groups|tags   ← 归口到 /products 与 /customers 的折叠区
                 pending-estimates|audit-logs|login-logs
                 reports sales|price|profit|statement   (带 --from/--to/--json/--page)
wc-cli order     sale create|void|star|reopen      purchase create|receive|void|star|reopen
                 sale plan        ← 新增：「用库存/需进货/多补」的 dry-run 预告（规则见报告 08 §5）
                 estimate add-row|fill
                 return sale|purchase create
wc-cli payment   create|list
wc-cli master    product|supplier|customer|unit|category|group|tag  create|update|enable|disable
wc-cli print     template list|show|update        ← 新增：打印模板存 DB（schema 有 PrintTemplate 模型）
                 render <单号>                     ← 新增：服务端渲染（客户端 window.print 不支持）
wc-cli review    list|mine|show|approve|reject|comment|revise   （审核只能人做；Agent token 无 review 权限）
                 # reject 只打标不动账：被驳回的单据已生效，需另行作废（§5.6 推论 1）
                 # revise 自动作废旧版并生成新版（复用 order reopen 实现，§5.6 推论 2）
wc-cli export    orders|inventory|statement --format csv|xlsx --out <path>
wc-cli ops       backup create|list|download|restore   health   version
```

**删除**：❌ `query drafts` —— `/drafts` 的数据源是**纯 localStorage**（`lib/form-draft.ts:13-22,73-93`，
key `wc-order-drafts:{userId}`，防抖 700ms，7 天过期），`schema.prisma` 里**没有 Draft 模型**，
服务端/CLI 完全不可见（✅ 报告 05 §5、08 §2 双向确认）。要有服务端草稿，得先新建模型。

**新增 `order reopen`**：v1 说"改单 = 作废原单 + 用原单内容重开"，✅ 成立，但**它是两个独立请求 +
前端 `router.push('/sale-orders/new?fromOrder=N')`**（`detail-actions.tsx:46-50`），
**CLI 无法从 action 层表达"这是一次改单"**；而且新版与旧版**没有任何关联字段**（也就是 §5.6 `revisionOf` 的缺位）。
所以 "改单" 需要一个真正的服务层入口，而不是让 CLI 自己拼两个请求。

**通用参数**：`--json` / `--table`；`--origin agent|human`、`--run <agentRunId>`、`--review pending_review|approved|rejected`；
写命令 `--dry-run`（默认）/ `--yes` / `--confirm <单号>`。
每条命令都要有 `--json`、`--dry-run`（写命令）、以及 **`--help` 里的示例**（Agent 最依赖示例）。

**`ops` 的面部限制（安全）**：
- `ops health` 可零改造复用 `/api/health`。
- `ops backup create|list` 可以给。
- **`ops backup restore` 必须拒绝暴露给 Agent**：恢复是逐表 `DELETE`、**无事务**、不校验 schema 兼容、
  且会清空会话（报告 04 §5）；属于"不可逆且超出授权"（§5.7 的停下情形①）。
- **`ops backup download` 也应拒绝**：现有端点泄露整库且无审计（报告 04 §5）。

---

## 8. 分步实施计划（Phase 0 已完成）

**Phase 0 · 调查补全 —— ✅ 已完成（本文即产出）**
8 个只读子智能体分两批并行，明细落库 `docs/research/01..08`，汇总成本文（已核实版 v2）。索引见 `00-索引.md`。

**Phase 0.5 · 先修缺陷（⚠️ 新增）—— 🟡 进行中**
- ✅ 2026-09-14 已修 P0-1（估价标志 + 行级 `unitId`）、P0-2（进货退货单号查错表）、P1-3（参考售价清零）；
  同时做了只读连库诊断（§3.6）。回归：`npm test` 41 例全绿、`tsc --noEmit` exit 0、`eslint` 无告警。
- ⏳ 待办：P0-1/P0-2 的**经 UI 端到端验证**（见 §3.6 末尾两个待办）；生产库的存量损坏排查（本机连不上生产库）。
- ⏳ P1-1/P1-2（审计静默丢失）**并入 Phase 1** 一起改（反正要重构 `audit.ts`，见 §13.6）。
- ⏳ P1-4/P1-5/P1-6 与 P2 的口径分叉，在 Phase 2 对数验收前按 §13.8/§13.9 裁决。

**Phase 1 · 骨架与鉴权 —— 🟢 主体已完成（2026-09-14），验收通过**

已完成：
- `ApiToken` 模型 + 迁移 `20260914040000_cli_api_token`（照 `Session` 模式：只存 sha256、`expiresAt` 可空、可吊销）
- `src/lib/auth/api-token.ts`：`hashToken` / `newTokenPlaintext` / `resolveApiToken`（**不带 `server-only`**，见 §6.1 的理由）
- `src/lib/cli/types.ts`：`Actor` / `CliResult` / 权限词表 `SCOPES` / 错误码→HTTP 与退出码**两处映射只定义一次**
- `src/lib/cli/registry.ts`：op 注册表（`requiredScope` / `humanOnly` / `write` 集中声明，新增命令不可能漏挂鉴权）
- `src/app/api/cli/v1/route.ts`：单入口 POST，**只认 Bearer、不接受 cookie**（无 ambient credential → 免 CSRF）
- `scripts/api-token.ts`：`create` / `list` / `revoke`（本地受信执行；明文只打印一次，审计里**不记明文**）
- `cli/`：`wc-cli auth whoami`、`auth check-review`；令牌从 `WC_TOKEN` 或 `~/.config/weichuan/token` 读，地址从 `WC_BASE_URL` 读

验收结果（实测，非推断）：
| 用例 | 期望 | 实测 |
|---|---|---|
| `auth whoami`（JSON / `--table`） | 返回 kind=agent、userId、role、scopes、tokenName | ✅ |
| `--run run-20260914-01` | 批次 id 回显（后续审核台按批次过） | ✅ |
| Agent 令牌调人类专属 op | 403 → 退出码 3 | ✅ 退出码 3 |
| 没有令牌 | 退出码 3 + 指路到铸造命令 | ✅ 退出码 3 |
| 令牌无效 | 退出码 3 | ✅ 退出码 3 |
| 未知命令 | 退出码 2 | ✅ 退出码 2 |
| 对端点发 GET | 405 + Allow: POST | ✅ 405 |
| **吊销后立即失效**（`revoke --id 1`） | 退出码 3 | ✅ 退出码 3；`lastUsedAt` 也正确记录 |

两处与计划的偏离（都是收窄，不是扩张）：
1. **CLI 没有引 commander**，改为自写 ~40 行分发。理由：Phase 1 只有 2 条命令，"装一个依赖"换来的收益不如"零依赖、无安装步骤"。
   命令面在 Phase 2 长到十几条时再换 commander，届时只是把 `COMMANDS` 表改成注册调用，机械改动。
2. **迁移不用 `migrate dev`**，改用 `migrate diff --from-schema-datasource` 生成 SQL 后手工建迁移目录 + `migrate deploy`。
   理由：`migrate dev` 在检测到异常时会**自动重置数据库**，而你 dev 库里有正在测的数据。改 schema 前先 `npm run backup` 备份了一次。

仍未完成（Phase 1 剩余）：
- ~~审计改造（A5 / P1-1 / P1-2）~~ → ✅ **已于同轮完成**，见下方"审计改造"。
- **端点层的"每次调用记审计"**：暂缓。现在没有任何写 op，加了就是死代码；Phase 3 接上第一个写命令时随服务层一起做。
- **按令牌限流**：现有节流是 `login_logs` 计数（账号/IP），不能承载令牌维度。

#### 审计改造（A5 / P1-1 / P1-2 / P1-7）—— ✅ 已完成并实测

改动：
- `AuditLog` 新增 `entity_key`（迁移 `20260914050000_audit_entity_key`）——字符串标识不再走 `BigInt()` 被静默丢弃
- `src/lib/audit.ts` 重写：**去掉 `server-only`**（审计要被服务层/脚本/端点共用）、新增 `tx` 参数、
  `ip` 可注入且 `headers()` 用 try/catch 守住、事务内失败**抛出去**（业务跟着回滚）、
  事务外失败打 `[audit][LOST]` 前缀（可检索告警，不再是一行悄悄话）
- 3 处"事务内却用全局 prisma"的审计补上 `tx`：`sale-orders/actions.ts`（自动补货单审计、级联作废审计）、
  `purchase-orders/actions.ts`（建单审计，此前 P2002 重试会写多条）
- 审计页能显示 `entity_key`

实测（7 项断言全过，验证行已清理）：
| 用例 | 结果 |
|---|---|
| 进程外（tsx，无请求上下文）写审计 | ✅ 写入成功，`ip` 记 null 而不是整体丢失（旧实现被 `headers()` 抛错吞掉） |
| `entityId: "backup-config"` | ✅ 落 `entity_key`，`entity_id` 为 null（旧实现静默丢弃 → 备份配置变更长期无审计） |
| 数字主键 `42` | ✅ 仍落 `entity_id`，保持历史行为 |
| 事务内写 + 事务内可读 | ✅ |
| 事务内写 + 业务回滚 | ✅ 审计一并回滚，不留"假审计" |
| 事务内写 + 提交 | ✅ 正常落库 |

仍未处理（有意留着，属 Phase 3）：**其余 71 处 `writeAudit` 仍在事务之后调用**——
方向相反的风险是"业务已提交、进程在写审计前挂掉 → 审计缺失"。要根治得让每个写 action 把业务事务与审计合并，
那是服务层抽取时一并做的事，不在 Phase 1 范围。
另外 `sale-orders/actions.ts:200-212`（按厂家名自动建档）用全局 prisma、不在事务里，
"补货单最终回滚但厂家档案已建"这个不一致也留着，属同一批重构。

- ⚠️ 注意：改 schema 后**必须重启 dev**（AGENTS.md，本次已执行）；生产迁移是人工 `docker compose exec app npx prisma migrate deploy`（报告 07 §3）。

**Phase 2 · 查询面（只读，先把"看得见"做全）**
- 抽只读服务：复用 `customer-profile`、`reports`、`price-analysis`、各列表页查询
- `query *` 全部命令 + `--json` + 分页 + 时间范围
- 验收：**按报告 05 §6 的 24 项对数清单**，逐项与页面数字对齐；开工前先裁决 §3.5 P1-4/P1-5 的口径

**Phase 2.5 · Agent 溯源 + 审核流**（✅ 按 §12 A3/A4 的决策调整：**立刻生效、留痕在后**，不必与 Phase 3 合并）
- schema：业务表加 `actorKind`/`agentRunId`/`apiTokenId`/`operatorUserId`；5 类单据
  （售卖/进货/售卖退货/进货退货/收付款）加 `reviewStatus`（**默认 `not_required`**）
  + `reviewedBy`/`reviewedAt`/`version`/`revisionOf`；新增 `ReviewNote`；`AuditLog` 加 `actorKind`/`agentRunId`/`apiTokenId`
- 服务层「创建单据」统一写来源与审核状态；**Agent 单照常立刻生效**（不拆 `createX`/`applyX`，不动现有事务结构）
- 审核台页面（批次分组、批量通过/驳回、填意见 + **「已驳回未作废」待办视图**）；列表来源/审核角标 + 筛选；工作台加一行 Agent 代做统计
- `revise` 复用 `order reopen` 的实现并**自动作废旧版**（§5.6 推论 2）
- 权限：审核只给人；Agent token 不含 review scope；**自审自批直接拒绝并写审计**
- CLI：`review list|mine|show|approve|reject|comment|revise`
- 验收（端到端，跑完清理数据）：
  ① Agent 建售卖单 → 库存与成本**立即按单变动**，且与人工建同内容的单**逐项对数一致**；
  ② 人驳回并写意见 → 该单进入「已驳回未作废」待办，且业绩口径里不再计入；
  ③ Agent `revise` → **旧版自动作废**（库存按作废规则冲回，注意按当前均价）、新版生效且带 `revisionOf`；
  ④ 覆盖性验收：Agent 建一张退货单与一笔付款 → 均立刻生效 → 同样能被驳回并作废

**Phase 3 · 核心写操作（服务层抽取 + CLI 命令）**
顺序按业务风险从低到高：主数据 CRUD → 收付款 → 开单 → 确认入库 → 退货 → 作废/改单 → 估价补单。
每步都要：单元测试（服务层）+ CLI 端到端（真库跑一遍再清理）+ `--dry-run`。
**服务层抽取时务必让服务模块不带 `server-only`**（§6.1），否则后续测试与复用都会被卡住。

**Phase 4 · 导出与运维**：`export`（复用 exceljs 逻辑）、`ops backup create|list`、`ops health`、`ops version`

**Phase 5 · 收尾**：`docs/cli.md`（命令 + 示例 + 权限 + 安全约定）、README、Agent 提示词样例；
回归 `npm test` / `lint` / `tsc` 全绿（现状：41 例测试全绿且**无需 DB**、lint/tsc 均 exit 0，报告 07 §7——
但 `tests/*.test.ts` 是单层 glob，**收不到 `cli/` 下的测试，需扩 glob**）

---

## 9. 待核实清单（✅ 已全部核实，剩余空白如下）

v1 的 8 条已全部查清，结论分别在 §1/§3/§4/§5（对应报告 01–07）。**仍然空白、动手前需自行确认的**：

1. 各报告末尾「未能核实的点」小节（8 份报告共约 15 条），主要是：打印抬头迁移意图、
   部分报表页未逐行读完、少量 guards 判定在页面级的差异。
2. **生产环境实际数据形态**：🟡 部分完成——2026-09-14 用**本机 dev 库**做了只读诊断（结论见 §3.6），
   但**生产库连不上**（compose 的 mysql 无端口映射，报告 07 §2），所以生产是否存在存量损坏
   （估价行、超退、参考售价被清零）**仍未知**，需在能连生产库的机器上重跑同一批只读查询。
3. **备份链路的实际运行者**：`backup:if-due` 由谁调度（宿主 cron？），`/api/health` 只看 `.gpg` 是否够（报告 07 §5 给了证据但运行方式未确认）。

---

## 10. 风险与对策（已按实证更新）

| 风险 | 对策 |
|---|---|
| **CLI 复用的逻辑本身有缺陷**（§3.5） | **先做 Phase 0.5**；每抽一个服务函数先写单测固化现有行为 |
| CLI 绕过业务规则直接写库 → 库存/成本错乱 | 强制走服务层；CLI 里**禁止**出现 `prisma.*.create/update/delete`（lint 规则或 review 卡住） |
| CLI 误删/误作废 | 默认 dry-run + 破坏性操作需显式回执 + 全部写审计 |
| **审计静默丢失**（`audit.ts` 吞错、`headers()` 依赖） | 修在事务外/无上下文路径；CLI 端点必须显式传 `ip`；给 `writeAudit` 失败加可观测告警 |
| Agent 自审自批 | review 权限与写权限分离（`ApiToken.scopes`）；越权拒绝并写审计 |
| 与网页行为不一致 | 服务层一份逻辑；按报告 05 §6 的 24 项清单对数验收 |
| **同名列不同口径**（工作台 vs 应收应付、报表不冲退货、报表含估价行） | 对数验收前先裁决口径，并在 CLI 文档里写明每个数字的定义 |
| token 泄露 | 只存哈希、可吊销、有有效期、不进命令行参数、scopes 可缩小（照 `Session` 模式） |
| 并发冲突 | 复用现有唯一约束/事务；CLI 报冲突退出码 5。⚠️ 注意现状：状态校验在事务外，唯一约束兜底有限（§3.5 P2） |
| **留痕在后：审核不阻止错误**（A3 决策的固有代价，**已决定不加熔断**） | 补救手段是**事后快速作废/改单** → 因此「已驳回但未作废」待办必须显眼且真有人看（§5.6）。⚠️ 残余风险：作废按当前均价冲回，不是完美撤销，每次补救都扰动库存金额 |
| **驳回后未作废 → 单据仍挂在库存/成本账上** | 审核台含「已驳回但未作废」待办视图并置顶；驳回意见模板默认带"请作废该单" |
| **`revise` 未作废旧版 → 新旧两版重复计入库存与成本** | `revise` **强制自动作废旧版**（复用 `order reopen` 实现）；`revisionOf` 记血缘；审核台默认只看最新版 |
| **反复 revise/reopen 扰动移动加权成本** | 作废按**当前**均价冲回、与扣出时不等（报告 01/02 实证）→ 审核台显示修订轮次，同一单超 N 轮告警 |
| 统计口径混淆（已生效但被驳回的单） | **库存/成本/流水口径必须包含所有已生效单据**（否则与物理库存对不上）；**业绩类口径**把 `rejected` 单独一行或排除 |
| Agent 中途乱问、人被反复打断 | §5.7 工作协议 |
| 生产 CLI 连不上库/镜像无源码 | 已是既成事实 → 用 §6.1 的 C′ 方案（HTTP 端点），不要试图直连 |

---

## 11. 多智能体分工与上下文预算（工作方法）

**数量没有硬上限**，真正的约束是**每个子智能体的最终报告都会进主智能体上下文**。Phase 0 按此执行并验证有效：

1. **子智能体把明细写进文件** `docs/research/NN-<主题>.md`；最终消息只回**不超过 10 行的摘要 + 文件路径**。
   → 本次 8 份报告共 3459 行，进主上下文的只有 8×10 行摘要。**这个方法有效，继续用。**
2. **分批并行**：每批 4 个；一批跑完、摘要落库、再起下一批（本次两批，各约 2–3 分钟）。
3. **长任务用后台运行**，主智能体同时推进别的部分。
4. **一个文件只有一个写者**：实现阶段按模块切分（鉴权 / 查询命令 / 写服务层 / 审核流 UI / 测试）；
   **计划、集成与验收由主智能体负责**（口径一致、对数验收、回归全绿）。
5. 每份简报必须写清：硬性只读约束、输出格式、"给 `file:line` 证据、不要泛泛而谈"。
6. **新增（本次经验）**：子智能体的结论**必须被主智能体抽样复现**。本次 3 个 P0/P1 缺陷里，
   有 1 个（P1-3 `refSalePrice` 清零）是主智能体在复现别人结论时**顺带发现**的——
   而两个子智能体对"`estimated` 是否漏写"给出了**互相矛盾**的说法（轨道 2 说漏、轨道 1 说漏在别处），
   只有回到源码才发现真相。**摘要互斥时必须回源裁决。**

---

## 12. 需要你拍板的事项（完整清单）

> 本清单汇总 Phase 0 八份报告里所有"需要业务判断、代码里没有答案"的事项，按**什么时候必须答复**分四档。
> 「我的建议」都是可以按默认执行的；你不回复时我按建议走，但不建议在 A 档上默认——它们决定 schema，改起来贵。

### 12.1 A 档：现在就要定（阻塞 Phase 1 的 schema 与骨架）

| # | 事项 | 选项 | 我的建议 |
|---|---|---|---|
| **A1** | **CLI 传输形态** | ① HTTP `/api/cli/*` + 服务层（C′）<br>② 进程内直连（要去掉 `server-only` **且**放开生产 DB 端口） | ✅ **已定并已实现：①**。`/api/cli/v1` 单入口 + `lib/cli/registry.ts` 集中声明权限；Bearer-only、免 CSRF。见 §8 Phase 1 的验收表 |
| **A2** | **token 权限粒度** | ① `ApiToken.scopes` 显式区分 `write` / `review`<br>② 只看角色 | ✅ **已定并已实现：①**。`SCOPES` 词表在 `lib/cli/types.ts`；`humanOnly` 的 op 对 Agent 令牌直接 403（已实测退出码 3） |
| **A3** | **审核的生效时机** | ① 把关在前（通过才动库存/成本）<br>② 立刻生效，审核只留痕 | ✅ **已定：② 立刻生效、留痕在后；且不加熔断**（补救靠事后快速作废/改单）。<br>**推论（已写进 §5.6，必须一起做）**：①"驳回"不等于撤销 → 驳回必须绑定「待作废」待办（**这是唯一的人工安全网**）；②`revise` 必须自动作废旧版，否则新旧两版重复计入库存与成本；③库存/成本口径含所有已生效单，业绩口径单独剔 `rejected`。<br>**简化**：不需要拆 `createX`/`applyX`，Phase 2.5 与 Phase 3 **不必合并排期**。<br>**残余风险（已记录，勿忘）**：作废按当前均价冲回，不是完美撤销，每次补救都扰动库存金额 |
| **A4** | **审核流是否覆盖退货与收付款** | ① 覆盖（`sale_return`/`purchase_return`/`payment` 也走 `reviewStatus`）<br>② 只管售卖/进货单 | ✅ **已定：① 覆盖 5 类单据**。退货写库存、付款动应收应付，且它们同样立刻生效；被驳回时同样适用 A3 推论①（付款**只能作废不能修改**，报告 03 §3） |
| **A5** | **审计写失败时是否阻断业务** | ① 维持现状（吞掉 + 打日志）<br>② 写失败即让业务失败 | ✅ **已定并已实现（§13.6 的第三个做法）**：写操作的审计用业务同一个 `tx` 写、失败即抛（业务回滚）；事务外调用不阻断但打 `[audit][LOST]` 醒目前缀。两条静默丢失路径（`headers()` 依赖、`BigInt()` 抛错）已修并实测 |
| **A6** | **排期：是否先做 Phase 0.5 修缺陷** | ① 先修 P0/P1 再开工 CLI<br>② 与 CLI 并行 | ✅ **已定：先修。P0-1/P0-2/P1-3 已于 2026-09-14 修完**（§3.6 含诊断证据）；P1-1/P1-2 并入 Phase 1；口径类留到 Phase 2 前裁决 |

### 12.2 B 档：对应 Phase 开工前定（不阻塞 Phase 1）

| # | 事项 | 选项 | 我的建议 |
|---|---|---|---|
| **B1** | **报表口径裁决**（四个子问题，Phase 2 对数验收前必须逐条裁决，报告 05 §6.3 列了 12 个风险点） | ① 工作台"应收/应付总额" vs 应收应付页：以哪个为准<br>② 厂家对账（从 `payments` 求和）vs 其它（用 `received_amount/paid_amount` 冗余列）：统一哪一个<br>③ 销售额/毛利是否冲减退货（现状**不冲**）<br>④ 报表是否排除估价行（现状**不排除**，估价行成本 0 会虚高毛利率） | ①以应收应付页为准（它有 `GREATEST` 与时间范围，修工作台）②统一用冗余列（`supplier-statement` 改）③**保持不冲**，但 CLI 字段名要体现（`salesGross` vs `receivableNet`）④**排除**，否则报表口径本身是错的 |
| **B2** | **时区** | ① CLI 强制 `TZ=Asia/Shanghai` 并在文档写明<br>② 不约束 | **①**。所有"本月/今日"默认值依赖进程时区，`/sales-analysis` 还硬编码 `+08:00`；不同 TZ 下对数必然差一天（报告 05 §7.5） |
| **B3** | **主数据重名策略** | ① CLI 默认拒绝重名（`--allow-duplicate` 才放）<br>② 与网页一致（不查重） | **①**。库只对 username/unit/group/tag 名与 `product.code` 有 unique；`saveSupplierAction` 连查重都没有（`suppliers/actions.ts:35-68`），而重名会污染开单的"按名建档"逻辑（`sale-orders/actions.ts:193-197`） |
| **B4** | **作废「已有退货」的售卖单该怎么办**（现状是多补库存） | ① 直接拒绝作废，要求先处理退货<br>② 只回补未退部分<br>③ 级联作废退货单再作废原单 | **①**（最不容易错）。现状 `sale-orders/actions.ts:536-559` 不校验退货，会把整单数量补回库存 |
| **B5** | **`export` 命令的面** | ① 只做可复用的 `export report <tab>`（6 个报表 tab）<br>② 另做 `export orders|statement`（新功能）<br>③ 还要 `--format csv`（现状只有 xlsx） | **①先做**，②③按需。主数据**没有任何导出**，都是新功能 |
| **B6** | **打印抬头存在哪** | ① 维持"抬头/地址/电话存 localStorage，模板存 DB"<br>② 把抬头迁进 `PrintTemplate`（看代码像是迁移做了一半） | 需要你确认**原本的意图**：`print-editor.tsx:37,51-90` 与 `PrintTemplate` 里两处都有公司信息。这决定 `print` 命令能不能完整复用；顺带确认 `print-auto.tsx` 的 `PrintAuto` 是死代码还是预留 |
| **B7** | **能力范围（四个小项，可一次答完）** | ① 是否需要"给已有单据追加估价行"（`order estimate add-row`）——现状**没有**这个服务端入口<br>② 是否需要父子分类（schema 有 `product_categories.parentId` 但 action/页面都是一级）<br>③ `master user` 是否需要"改角色"（现状无 `role set`、无 delete）<br>④ 估价行是否需要"取消估价"（维持单向） | ①③④ **默认不做**，除非有明确业务场景；②默认不做。这四项都是"新增能力"，不是修 bug |
| **B8** | **`ops` 的面与备份双轨** | ① 备份读哪一套（应用自导 JSON+gzip vs shell 的 GPG 包，生产指向同一目录）<br>② `ops version` 是否值得做（`package.json` 不在 runtime 镜像里，要做就得改 Dockerfile 或构建期注入）<br>③ `restore`/`download` 是否对 Agent 关闭 | ①③ **按 §7 的设限**：`create|list` 给、`restore`/`download` 拒绝；②默认**不做**，收益撑不起改镜像的成本 |
| **B9** | **库存预警口径** | ① `query inventory --warn-only` 下推 SQL<br>② 照抄页面的"分页后 JS 过滤" | **①**，并顺手修页面的 P1-5（预警数只算当前页 50 条）。CLI 必须比页面正确，且要在文档里写明差异 |

### 12.3 C 档：不是决策，是需要你授权我去做的动作

1. **查数据现状**（只读、需要连库）：是否已存在 `estimated=true` 的历史行、有没有"同一天第 2 张 PRF 失败"的痕迹、
   有没有超收/超退单据、有没有负库存。这几项决定 §3.5 的缺陷是"潜在"还是"正在发生"（各报告都标为未核实）。
2. **修 §3.5 缺陷**（改代码）：P0-1/P0-2/P1-3 是明确 bug、无口径歧义，但涉及改线上业务逻辑，我不擅自动。

### 12.4 D 档：不必你定（我按这些默认做，除非你否决）

- `ApiToken` 照 `Session` 的既有做法（只存 sha256、有 `expiresAt`、可删行吊销）；token 只从环境变量/文件读，**不进命令行参数**。
- CLI 默认 `--dry-run`，写操作要 `--yes`，破坏性操作要 `--confirm <单号>`；退出码按 §6.3 的表。
- 服务层模块**不带 `server-only`**（沿用 `pinyin-server.ts:8-10` 的先例），"只在服务端跑"的约束交给 action/端点层。
- **CLI 侧完全不碰 Prisma**（它是 HTTP 客户端）；服务层与端点层必须 `import { prisma } from "@/lib/prisma"`，**禁止 `new PrismaClient()`**——否则 `search_pinyin` 静默写 NULL（报告 04 §7.5）。
- `npm test` 的 glob 从 `tests/*.test.ts` 扩到能覆盖 `cli/`（否则 CLI 测试不会被跑到）。

---

## 13. 推荐做法（按 §12 编号，可直接照此实施）

### 13.1 A1 传输形态：单入口命令分发 + 只认 Bearer

- **一个端点**：`POST /api/cli/v1`，body `{ op, input, dryRun, runId }`，`op` 与 CLI 命令 1:1
  （如 `sale.create` / `query.inventory` / `review.approve`）。理由：一个文件 + 一张注册表 = 最小面积，
  op→命令的映射是机械的，不会每加一个命令就多一个路由文件。
- **注册表声明权限**：`op → { service, requiredScope }`，权限判定与 scope 检查集中在一处，
  新增命令不会漏挂鉴权（现状没有 `middleware.ts`、鉴权散落，这是历史教训）。
- **只认 `Authorization: Bearer`，不接受 cookie 身份**：没有 ambient credential → 天然免 CSRF；
  且 CLI 用的 token 与网页会话互相隔离。按 token 限流（现有 `login_logs` 计数机制不适用，见 §6.2）。
- `ops health` 直接复用现有 `/api/health`（无需鉴权、无需 DB 身份）。
- **退出码映射**：`Result` 的 `error.code` → `FORBIDDEN=3`、`INVALID=2`、`RULE=4`、`CONFLICT=5`、成功 `0`。
- **两个身份解析器，产出同一个 `Actor`**：`actorFromSession()`（cookie，在 action 层）与
  `actorFromToken(req)`（在端点层）。两者都调同一批 `src/lib/services/*` 函数——
  这才是"网页与 CLI 行为一致"的落点。

### 13.2 dry-run：用「事务回滚探针」，不另写一套预估逻辑

**推荐做法**：dry-run **跑真实的业务代码路径**，在事务里照常写入，然后抛一个
`DryRunRollback(plan)` 把事务回滚掉，捕获它并把 `plan` 返回给调用方。

```ts
// 伪代码：dry-run 与真实执行共用同一条代码路径
await prisma.$transaction(async (tx) => {
  const plan = await createSaleOrder(tx, actor, input);   // 真写，真算成本/库存
  if (dryRun) throw new DryRunRollback(plan);             // 回滚，带着摘要出去
  return plan;
});
```

- **为什么**：Agent 场景最怕的是"预告的和实际执行的不一样"。另写一套预估逻辑必然与真实逻辑
  分叉（§3.5 那一批口径分叉全是这么来的：工作台 vs 应收应付、`payments` vs 冗余列）。
  回滚探针让"预告 = 实际"成为结构性保证，而不是靠人维护两份一致性。
- **前提**：所有写（含审计，见 §13.6）都在同一个事务里；事务内**不做不可回滚的外部副作用**
  （写文件、发邮件、调外部接口）。
- **例外**：`ops backup create` 这类产物是文件的操作，dry-run 只打印"将写入的路径 + 预计大小"，不真写。

### 13.3 A2 scopes 词表（够用就好，别设计成 RBAC）

`read` / `write:order` / `write:master` / `write:payment` / `review` / `ops`（`backup restore|download` 永不授予）。

- `review` 只发给**人类**用途的 token；Agent 用途的 token 一律不含 `review` → §5.6 的"不能自审自批"由 scope 强制。
- 每个 op 在注册表里声明所需 scope（§13.1），越权在端点层就拒绝**并写审计**。
- 每个 token 记 `userId`（授权它这么做的人）→ 溯源里的 `operatorUserId`。

### 13.4 A3 立刻生效：原「把关在前」的设计作废，改做这三件事

✅ **决策：立刻生效、留痕在后**（用户已定）。因此**不拆** `createX`/`applyX`、
不做"可延后调用的副作用函数"、**也不需要**"生效过滤唯一入口"（所有单都生效）。
原按"把关在前"准备的这部分工作全部取消，**Phase 2.5 与 Phase 3 不再需要合并排期**。

改做以下三件事：

1. **`reviewStatus` 的 DB 默认值 = `not_required`**（保留这条，依然关键）。
   于是**历史数据与人工流程的行为一字不变**，迁移是纯增量、零风险；
   只有 Agent 发起的写入才写 `pending_review`。
2. **驳回 = 标记 + 待作废，必须有人真的作废**。
   已生效的单据不能回溯撤销（不变量 1），唯一出口是 `void`。所以：
   - 审核台提供「已驳回但未作废」待办视图，**这个视图才是"审核"真正起作用的地方**；
   - 驳回意见模板默认带"请作废该单"；人也可以直接作废；
   - 5 类单据一视同仁（付款只能作废不能改，退货/付款作废同样有既有实现）。
3. **`revise` 强制自动作废旧版**（复用 `order reopen` 的实现 + `revisionOf` 记血缘）。
   不这么做，新旧两版会**同时生效**、库存与成本被重复计入。
   并接受一个已知代价：每次作废按**当前**均价冲回，反复 revise 会逐步扰动移动加权成本（§3.5 P2、报告 01/02）。

**不做熔断（✅ 已决策，勿再提方案）**：出问题后靠**快速作废/改单**补救。
因此第 2 条的「已驳回但未作废」待办是唯一的人工安全网，实现时要做显眼、并让人看得见；
同时记住作废按当前均价冲回、不是完美撤销（第 3 条的代价）。

### 13.5 A4 覆盖范围：5 类单据，一张枚举

`docType: sale_order | purchase_order | sale_return | purchase_return | payment`，`ReviewNote.docType` 复用同一枚举。
✅ **已决策：覆盖全部 5 类**。它们与开单一样**立刻生效**（退货照常冲减库存、付款照常 `increment`），
被驳回时同样走 §13.4 第 2 条（驳回 → 待作废）；
注意付款**只能作废不能修改**（报告 03 §3），所以驳回一笔付款的处置手段就是作废它。

### 13.6 A5 审计：改为「进业务事务 + 失败即回滚」

这是我在 §12 只给了两个选项、但更合适的**第三个做法**：

- **写操作的审计用业务同一个 `tx` 写，失败就抛**，让事务整体回滚。
  理由：同一套 DB，审计插不进去说明事务本身已经坏了；对进销存来说，
  **"无痕的业务变更"比"失败的一次请求"更糟**（钱和库存都变了却查不到谁干的）。
  这同时解决现状的"审计写在事务内却用全局 prisma，业务回滚后审计残留"。
- **登录/登出这类没有业务事务的场景**：保持不阻断业务，但必须**告警**（结构化错误日志 + 可观测信号），不能静默。
- **先修两条静默丢失路径**（否则上面两条都白做）：
  ① `ip === null` 时调 `headers()` → 改成可注入，CLI/端点显式传（如 `"cli"`）；
  ② `entityId` 走 `BigInt()` 传字符串会抛错 → 改为专用列或 `null`。

### 13.7 A6 排期：缺陷分三批，不要一次全修

| 批次 | 内容 | 为什么这个顺序 |
|---|---|---|
| 第一批（独立小修，各一处） | P0-1（`estimated` + 行级 `unitId`）、P0-2（进货退货单号）、P1-3（`refSalePrice` 清零） | 改动极小、无口径歧义、不依赖任何设计决策；不修则 Phase 2 的对数验收没有基准 |
| 第二批（并入 Phase 1） | P1-1、P1-2（审计静默丢失） | 反正 Phase 1 要重构 `audit.ts`，顺手一起改，避免改两遍 |
| 第三批（Phase 2 起手，与 B1 一起） | P1-4、P1-5、P1-6、P2 各类口径分叉 | 它们本质是"口径该是什么"的问题，与 B1 的裁决是同一件事 |

另外建议**顺手抽 `nextOrderNo(tx, prefix)`** 合并现在三份重复实现（`sale-orders`、`purchase-returns`、
`pending-estimates` 各写一遍），并给它加单测——P0-2 那个 bug 就是"查错表"没人兜，
而现在 `tests/` 下没有任何 action 级测试。

### 13.8 B1 口径裁决（✅ 已决策：由 Agent 代定，理由写在每条里，可随时推翻）

决策原则（按优先级）：**① 不改动既有报表语义**（避免切断历史对比）；**② 遵循"数据模型本身的事实"**（如估价行不占库存）；
**③ 对数验收优先**（CLI 与页面同口径）；**④ 会把负数减进总额、把没发生的货算进库存的，一律算 bug 先修**。

| # | 事项 | 决定 | 理由 | 状态 |
|---|---|---|---|---|
| 1 | 工作台 vs 应收应付页 | **两处逐单公式统一（都加 `GREATEST(...,0)`），时间范围有意不同**：工作台＝"当前未结清存量"（全部时间），页面＝"区间内未结清"。CLI 用两个字段名（`outstandingTotal` / `outstandingInRange`） | 逐单为负是"我们欠对方"（预收/预付），不是应收；把负值减进总额会让应收**少算**。时间范围不同是既有意图（卡片备注已写明"全部时间"），不该强行合并成同一个数 | ✅ 已实现并实测 |
| 2 | 估价行的售卖退货 | **不入库**：退货单照常生成、照常冲减应收与毛利，但跳过全部库存写入；作废退货单对称跳过；**售卖单作废也跳过估价行** | 估价行的货从没出过库存（`stockQtyUsed=0`）。入库＝凭空造库存，并按 0 成本把移动加权均价拉低；已补单的行还会把同一批货算两次 | ✅ 已实现（待你用界面点一次确认） |
| 3 | 销售额/毛利是否冲减退货 | **毛额为主（与页面一致），另给净额字段**（`销售额（毛额…）` / `销售额（净额…）` / 两个口径的毛利各一行）；**退货冲减只算"原单仍有效"的退货** | 既有报表都是毛额，且用户已按此对照经营；改主口径会切断历史对比。净额更"正确"，但作为独立需求单列，不在 CLI 项目里悄悄改 | ✅ 已实现（`summaryReport`，页面/Excel/CLI 三处共享） |
| 4 | 报表是否排除估价行 | **销售额包含（有真实售价）；成本/毛利必须标注"含 N 行估价、成本未计"，并给 `--exclude-estimated` 开关** | 估价行有真实售价，剔出销售额会少算收入；但它成本为 0（补齐前），不标注就会虚高毛利率。**不是静默扣减，而是让人看见** | ✅ 标注行已实现（`⚠ 其中 N 行估价待补`）；`--exclude-estimated` 开关待做 |
| 5 | 厂家对账取数 | **明细行读 `payments`（对账语义就是收款流水），余额汇总用冗余列 `received_amount/paid_amount`**；两套不等时告警 | 明细要看"哪几笔、什么时间"，汇总要与其它 3 处口径一致 | 🟡 随 `query statement` 实现 |

**实测证据（#1）**：dev 库里 `SO20260912-0008`（单额 ¥5000、已收 0、确认退货 ¥7500）产生未结 **−¥2500**。
修前工作台应收 ¥940.19（把 −2500 减进去了，少算），修后 ¥3440.19。应付侧无超付，数值不变。

### 13.9 B2–B9 的推荐做法

| # | 推荐做法 |
|---|---|
| **B2 时区** | CLI 强制 `TZ=Asia/Shanghai`；启动时校验进程 TZ，与端点回显的服务器 TZ 不一致就警告；`--json` 输出里回显"本次生效的区间 + TZ"（否则对数差一天时无从查起） |
| **B3 重名** | CLI 默认拒绝重名，提示"库中已有 N 条同名"；`--allow-duplicate` 才放行。**先不改 schema 加唯一约束**——生产可能已有重名，加约束要先治理数据，是独立任务 |
| **B4 作废含退货单据** | 拒绝作废，提示"该单已有 N 张退货/收款，请先处理"。校验要**进事务并用带条件的 updateMany**（现状校验在事务外，能双次作废）。语义上"这张单不存在了"和"已发生的退货"不能同时成立 |
| **B5 export** | Phase 4 先做 `export report <tab>`（复用现有 6 个 tab 的行数据，零新逻辑）+ csv 序列化；`export orders\|statement` 与主数据导出都算新功能，按需再排 |
| **B6 打印抬头** | **不阻塞 CLI**：`print render` 设计成接受 `--company/--address/--phone` 覆盖，先只保证模板字段。同时把"抬头迁进 `PrintTemplate`"立为独立小任务（迁移做了一半，两处并存迟早不一致）；顺带确认 `PrintAuto` 是否死代码 |
| **B7 能力小项** | 四项**全部默认不做**：①追加估价行——语义弱，"开单时不知道进价"才是估价行的由来，事后追加用改单即可；②父子分类——页面是一级，做树形要先定 UI/校验；③改角色——3 个角色的系统需求弱；④取消估价——单向是对的 |
| **B8 ops 与备份双轨** | 备份**收敛到应用内那套**（JSON+gzip）：它是应用语义的备份、页面/health/CLI 都能操作；shell 的 GPG 包**保留为运维层异地留存，CLI 不碰**（并把 `BACKUP_DIR` 两个不同默认值统一）。`ops version` **做，但便宜**：Dockerfile 加 `ARG`/`ENV APP_VERSION` 两行 + 构建期传参即可（比把 `package.json` 打进镜像更稳），端点返回它。`restore`/`download` 对 Agent 关闭 |
| **B9 库存预警** | CLI **下推 SQL**（`status=1 AND min_stock>0 AND stock_qty<min_stock`）再分页；同时修页面的 P1-5（现在是分页后 JS 过滤，预警数只算当前页）。CLI 要比页面正确，并在文档写明这个差异 |

### 13.10 D 档补两条重要的

- **行级可见范围必须进服务层**：`sales` 角色的列表与详情**都带 `operatorId` 过滤**（只看得见自己开的单，
  报告 06 §4）。CLI 必须复刻这条——否则用 sales token 的 Agent 能看到全量单据，是**越权读取**。
  这是本次矩阵核实里最容易漏、后果最直接的一条。
- **每次写操作自动带 `agentRunId`**：CLI 默认一批操作共用一个 runId（可用 `--run` 覆盖），
  审核台才能"按批次整体过"，人不用逐单点。

---

## 14. 每片的验收方式（Phase 2/3 实际执行下来的方法）

前面 18 个提交、六轮对数、约 150 项断言跑下来，这套流程证明是有效的——**它抓到的真 bug 比写代码时预想的多**。
后面高风险模块（开单、入库、退货、作废）照这个走。

### 每一片必须做的六件事

1. **端到端跑真实 HTTP + 令牌**，不是只调服务函数：退出码要对（0 成功 / 2 参数错 / 3 权限不足 / 4 业务规则 / 5 冲突）。
2. **对数**：服务层输出 vs **独立写一遍的原始 SQL**（不复用被测代码），逐项比。
3. **写操作验"预演不落库"**：连续预演 N 次后行数不变；再用 `--yes` 落库并核对。
4. **审计核对**：写操作必须留下带 `source`（`cli:<令牌名>`）与 `runId` 的记录，且与业务同事务。
5. **清理验收数据**：测试行要删掉/作废掉，恢复到原状并打印前后计数。**能用"作废"清理的就不用硬删**——
   作废是系统认可的反向操作且留下真实记录（收付款验收就是这么做的）。
6. **回归三件套**：`npx tsc --noEmit`、`npm run lint`、`npm test` 全绿。

### 三条踩出来的经验

- **测试脚本先报错时，先判清是"被测代码错"还是"参考实现错"，再动手改。** 这轮里两种都遇到过：
  参考 SQL 数错厂家数（我数的是"商品上用过的厂家名"，服务数的是"有商品的厂家档案"，服务才是对的）、
  测试脚本把计数按金额格式化成 `6.00`、裸 `created_at` 在多表连接里歧义。
  **绝不能为了让断言变绿而改断言**——那样就把真 bug 一起改没了。
- **测试自己会抓到真 bug**，而且抓到的是最阴的那类：
  `--enabled false` 被当成 true（`z.coerce.boolean()` 的锅，见 `lib/form-bool.ts`）、
  净额口径把"原单已作废的退货"算进冲减（净额一度是 −¥1090）、
  按客户筛选时只过滤了列表没过滤汇总。
  这三个都不是"读代码能看出来"的，**必须跑**。
- **验证脚本自己也会错**：写脚本时用到的 SQL／解构／格式化都可能出错。所以脚本报错时的第一反应是回源头核对，
  而不是直接相信它。

### 数据清理原则

- 验收用的令牌**当场吊销**（明文会出现在会话记录里）。
- 测试建的商品/客户/厂家/单位**删掉并打印前后计数**；能作废的（收付款）就作废。
- **审计行不删**：那是真实发生过的记录，删审计本身违反"只增不改不删"。
