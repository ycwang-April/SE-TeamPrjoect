# 软件设计实施与上下游交接清单

本清单从用户在 HAMA 确认 PRD 开始，到编码节点收到已确认设计、QA 能按原验收条件回查结果为止。适用于新建项目和已有项目变更。按步骤 1–7 实施；每个勾选项完成后，在对应变更或测试记录中附上证据。下列方框均为待实施或待联调事项。

## 交接总表

| 交接双方 | 生产方交付 | 接收方当场核对 | 异常回到哪里 |
| --- | --- | --- | --- |
| HAMA → 软件设计 | 已发布基线、原始需求与 AC、范围及审批记录 | 基线 ID、版本、摘要、目标工程；逐项核对需求与 AC 归属 | 来源缺失回需求工程；工作区选错回项目选择 |
| 设计生成 → 设计评审 | 版本化草案、模块与接口、需求追踪、文件范围、未决项 | 实现是否遵守当前基线，验收是否可观察，评审对象是否为当前修订 | 技术问题在设计内返工；需求范围变化回 HAMA |
| 已确认设计 → PM | 指定修订、结构化 GoalSpec、工作区与目标提交 | 原始编号、模块、文件范围和前置依赖是否进入 PM 报告及任务图 | 设计缺陷回设计修订；图编排缺陷回工作流草案 |
| 锁定工作流 → Coding → QA | 版本快照、节点契约、对应 AC、目标文件及验证办法 | 执行者能从节点输入找到实现依据；QA 能从运行证据回查原 AC | 实现缺陷在原范围内返工；设计或需求变化走对应上游修订 |

## 1. 先接通 HAMA 已发布基线

**起点与交接产物**　需求工程已发布基线。完成本步后，设计服务拿到指定版本的需求事实和明确选定的目标工作区，可以独立于演示数据起草。

- [ ] 在需求工程页的已发布基线旁接入“生成软件设计”。显式选择目标工程工作区并显示目标提交，向拟建的 `POST /api/designs` 提交 `baselineId、workspaceId、sourceCommit`。保留已有“导入下游编排”供原有调用方使用。点新入口只创建设计草案，创建工作流留到步骤 5。
- [ ] 服务端按 ID 调用基线读取服务。核对 `ApprovedRequirementsBaseline` 的 schemaVersion、id、projectId、revision、sha256，读取 approvedPrd、approval、confirmation 及存在时的 conditionalApproval。绑定服务端读取的版本，避免页面切换项目后将旧 PRD 与新项目混用。
- [ ] 读取 `prd.sections`、`prd.requirements` 和 `prd.trace`。保留 scopeKey、功能／非功能类别、原优先级、需求依赖、逐条约束，以及每条 AC 的原始 ID 和 Given/When/Then。试取一条 AC，沿需求和 trace 回查到来源议题及批准方案。
- [ ] 按 workspaceId 解析工作区，在选定提交清点已有入口、依赖、测试命令和相对路径。新工程将拟新增路径单列；尚无提交的项目先记录概念设计，绑定初始提交后进入正式评审。演示基线可走演练，正式交接要求 live 基线及工程工作区。
- [ ] 联调已发布基线、未知基线、源码版本不符和文档工作区四种输入。保存一份有效的“基线引用＋目标提交＋需求/AC 清单”，并确认失败响应能指出需要修正的输入。

接入依据见 [HAMA 契约](../requirements-engineering/src/contracts.ts)、[基线读取与既有交接](../requirements-engineering/src/service.ts) 和 [需求工程页](../workflow-orchestrator/renderer/src/views/RequirementsView.tsx)。

## 2. 定义设计工件并实现草案生成

**依赖与产物**　使用步骤 1 的基线与工程清单，产出同一修订的结构化正文、评审稿和 PM 导入预览。

- [ ] 在 software-design 中定义设计输入与输出类型及运行时 schema。正文包含目标、输入输出、模块、接口、适用的数据与质量约束、决策、假设、追踪和未决事项。对每个模块记录名称、层、职责、目标文件和原始需求引用；对跨模块接口记录提供方、消费方、输入、结果与失败语义。
- [ ] 在宿主 runtime 装配设计服务。参考 HAMA 的无工具文本调用，向 Design Agent 传入本项目的基线、源码清单、选定的模型和本修订的反馈。检查生成请求的数据来源，确保校园演示、账本预设等示例仅由演练或测试显式加载。
- [ ] 从每条获批需求的触发条件和可观察结果推导变化点，再按实际职责划分模块。已有工程指出复用或修改的入口，新工程标明拟建工件。仅有命令行或函数接口的项目也应能生成完整草案。
- [ ] 对模型返回先校验 schema，再校验引用。逐项检查 FR/NFR 实现归属、AC 验证方法、跨模块依赖、相对路径和重叠写入责任。将悬空 ID、缺少证据的假设和未覆盖的 AC 定位到具体条目；对生成失败记录诊断，允许用原基线与反馈重试。
- [ ] 从同一结构化正文渲染评审稿和 Markdown 预览。使用现有解析器检查预览的目标、模块、需求、AC 与文件范围；对照评审稿检查结构化原始编号。以新建命令行工具和已有服务改造各跑一次，保存输入与草案供评审联调。

编写结构见[通用模板](./design-spec-template.md)，调用与解析参考 [HAMA Agent](../requirements-engineering/src/agents.ts)、[宿主装配](../workflow-orchestrator/src/server/runtime.ts) 和 [Markdown 解析器](../workflow-orchestrator/src/core/spec-parser.ts)。

## 3. 实现可恢复的评审与确认

**依赖与产物**　使用步骤 2 的草案。在此阶段完成设计确认，产物是可按 designId、revision 和 contentSha256 精确读取的快照。

- [ ] 在宿主 SQLite 中加入 design_revisions、design_decisions、design_handoffs。按设计说明建立修订主键、决定引用和交接唯一键。以相同正文重复计算摘要，核对结果一致；改变来源、目标版本或正文后摘要应变化。
- [ ] 接入草案创建、修订读取、提交评审和新增修订端点。工作台显示基线与目标提交、需求到模块/AC 的追踪、未决事项和前后版差异。重启服务后重新打开指定修订，核对草案和决定记录。
- [ ] 实现 draft → in_review → confirmed，以及 in_review → changes_requested → 新修订 draft。确认请求携带 expectedHash、actor 和结论，在同一事务内检查状态、写决定并冻结正文。测试两位评审人针对同一旧摘要提交冲突决定，后一次应看到冲突及当前版本。
- [ ] 演练两类退回。技术方案问题在同一基线下追加设计修订；若反馈改变用户目标或通过标准，返回 HAMA，发布新基线，再对比稳定需求及 AC 并启动对应设计。两条路径都应能回读历史正文、意见和处理结果。

端点、数据字段与响应条件见[子系统设计说明](./subsystem-design.md)。

## 4. 把确认设计投影为 PM 输入

**依赖与产物**　按步骤 3 的快照构造结构化 GoalSpec。先验证纯映射，再在步骤 5 创建工作流。在此处使用 [Planner 的结构化入口](../workflow-orchestrator/src/engines/planner.ts)和[下游契约](../workflow-orchestrator/src/shared/types.ts)。

| 来源 | GoalSpec 或关联记录 | 必须验证的对应关系 |
| --- | --- | --- |
| 上游基线 | requirementsBaseline | id、projectId、revision、sha256 与步骤 1 完全一致 |
| PRD 需求及验收 | requirements、acceptanceCriteria | 需求 id 和 code 均取原 r.id；AC id 和 code 均取原 a.id，requirementId 指向所属需求。保留验收语义，初始 verified=false |
| 已确认设计正文 | rawMarkdown、title、goal、inputs、outputs、constraints、domainRules、assumptions、modules | 每个模块的 artifacts 是目标工程路径，relatedFrCodes 指向原始需求 code，可包含 NFR；保留已确认的接口及依赖供节点使用 |
| 设计修订与交接 | design_handoffs 及锁版时的修订引用 | 从 workflowId 可定位同一个 workspaceId、designId、revision 及对应摘要 |

- [ ] 在映射测试中逐个比较 ID 与集合，覆盖一条需求有多个 AC、一个模块关联多个需求及一条 NFR 跨模块的情形。沿用现有投影将 must 保留为 must、should/could 映为 should，设计快照保留原优先级。
- [ ] 为设计补充检查记录其来源与关联需求，确保与 HAMA 原始 AC 可区分。Markdown 短编号仅供人工预览和手工导入；新正式路径直接传结构化对象，以保留原始 ID 和 AC.requirementId。
- [ ] 准备一个契约先行的测试输入，写明提供方、消费方和共享约束。分别核对独立切片和因 worker 上限合并切片时的需求与路径覆盖；对必须顺序执行的工作验证前置契约任务或有向依赖。

## 5. 原子交接并打开正确的工作流

- [ ] 接入 `POST /api/designs/{id}/revisions/{rev}/handoff`。校验 expectedHash、确认状态、基线模式与目标工作区。对首次交接复核目标提交；若源码已变，展示受影响范围并转回设计复核。成功交接后的网络重试应能找回原工作流。
- [ ] 以 (designId, revision, workspaceId) 去重，使 Planner 的工作流、GoalSpec、PM 报告、图、校验结果与交接关联同时提交；在提交成功后广播更新。注入一次落库失败，确认可重试且没有遗留半套工件；并发提交两次只形成一个 workflowId。
- [ ] 首次成功响应返回 201，重复成功请求返回 200 及同一 workflowId。前端用该 ID 打开工作流详情，展示 PM 报告、图和校验状态。若图有阻断问题，保留 draft 和具体诊断，交接记录可用于定位原设计。
- [ ] 从工作流详情反查到设计版本，再取一条 PM 切片，核对 requirementRefs、fileScope 和实际依赖。保存交接响应及该切片作为 PM 接收证据，同时回归旧的基线直导与 Markdown 导入。

改动涉及 [HTTP 路由](../workflow-orchestrator/src/server/http-router.ts)、[Planner 保存与广播](../workflow-orchestrator/src/engines/planner.ts)、[PM 分解](../workflow-orchestrator/src/core/pm-planner.ts) 和[工作台客户端](../workflow-orchestrator/renderer/src/api/client.ts)。

## 6. 锁版并把设计交给 Coding 与 QA

- [ ] 在工作流草案核对 PM 切片后执行图校验和试运行，记录阻断项及处理结果。锁版时复核当前图与确认设计的一致性，并在 WorkflowVersionSnapshot 中绑定设计修订引用或等价的不可变内容。历史工作流沿用既有快照读取路径。
- [ ] 在运行器构造节点输入时，从**本次运行绑定的工作流版本**按 requirementRefs 和文件范围解析具体接口、数据约束、关联 AC 与验证方法。保留现有上下游节点输出和 inputContract/outputContract，并将对应 fileScope 传给能力执行器。
- [ ] 捕获一次实际发给编码能力的任务输入。任选一个节点，核对可见契约和原始 AC、目标 worktree 与授权文件范围。随后发布新版设计并重试旧运行，检查重试仍读取原确认版本。
- [ ] 在 QA 侧对每条原始 AC 记录运行版本、节点或尝试、验证方法和观察结果。自动检查保存命令、退出码及相关断言结果；人工验收保存操作条件、观察结果与确认记录。模拟一项失败，检查能从证据回到原需求和负责模块，再决定编码返工、设计返工或需求变更。

锁版行为见 [runTrial 与 confirmVersion](../workflow-orchestrator/src/engines/planner.ts)，执行交接见[运行器的节点消息与能力调用](../workflow-orchestrator/src/engines/orchestrator.ts)。现有 confirmVersion 会重新检查图校验结果，并保存最近的试运行报告；联调时应记录实际执行过的试运行。

## 7. 联调、回归与签收

- [ ] **通用性。** 使用三个独立项目覆盖不同边界：校园报名演示检查移动端和容量约束；账本测试基线检查分录和汇率契约；新建命令行工具检查文件输入、输出和退出码。账本预设用于下游对照，验证生成时只提供本项目基线与工程材料。核对每个产物只含本项目的编号和路径。
- [ ] **真实链路。** 用一项非校园需求走一次 live 输入 → HAMA 确认 → 设计生成与确认 → PM → 编码 → 业务验收。记录 projectId、基线引用、目标提交、设计引用、workflowId、versionId、runId 和至少一条原始 AC 的验收证据。沿这些引用正向与反向各查一次。
- [ ] **变更与隔离。** 将命令行工具从“忽略纯空白行”改为“纯空白行也计数”。同一份三行输入的预期值从 2 变为 3。核对新基线和新设计反映差异、文件缺失的失败行为仍被覆盖、旧运行仍可复现原结果。
- [ ] **仓库回归。** 在仓库根目录执行 `node --experimental-transform-types --test requirements-engineering/verify/hama.test.ts`；在 workflow-orchestrator 目录执行 `npm run typecheck`、`npm run build` 和 `npm run verify:gates`。将新增的设计契约、版本冲突、交接幂等和节点上下文用例接入实际测试入口，记录执行命令与结果。
- [ ] **签收。** 需求侧核对原始需求与 AC，设计侧核对修订和决定，编排侧核对图与版本，执行及质量侧核对节点输入和验收证据。每一侧均能据同一组引用找回自己的交付物；遗留问题写明所属阶段、受影响条目和复验方法。

测试范围与案例输入见[实现与验收方案](./implementation-plan.md)。建议每次正式联调用一行记录保存证据入口：

| 项目 / 基线版本与摘要 | 工作区 / 提交 | 设计修订与摘要 | 工作流 / 版本 / 运行 | 原始 AC / 节点 / 结果与证据位置 |
| --- | --- | --- | --- | --- |
| 〈本次基线〉 | 〈本次代码版本〉 | 〈本次确认快照〉 | 〈实际三个 ID〉 | 〈可回查记录〉 |
