# Lodge

> Lodge：以寮为本体的多Agent编码工作台，一室一任务，席位驻于寮内，隔离交付、可验可溯。
> 一寮承事，灵侣偕居，功成俟鉴

**Room-first multi-agent coding workspace**

Lodge 将寮（Lodge）作为一等公民本体。席位驻于寮中，对话只是寮内日志；目标、席位配置、工作区隔离、验收证据全部依附于寮。

- 🏠 **Lodge** = 独立任务房间（本体）
- 🧑‍💻 **Seat** = Agent席位
- ✅ **acceptance_cmd**：可执行命令作为验收证据
- 🛡️ **工作区隔离**：git 仓库用 worktree，普通目录用复制隔离；交付工作区不被其他席位覆盖，它不是文件系统沙箱
- 📦 **交接包**：真实房间可导出 BRIEF/结论/对话/事件/证据，另一个实例只读打开，并可基于 BRIEF 续做
- 🧪 **示例**：[examples/rooms](examples/rooms) 有可直接打开的样本（3 个模拟 + 1 个真实）
- 📌 **项目约束**：仓库根 `LODGE.md` 写架构与约定，建房时可读取并带入 BRIEF
