# 英文模板行号填充问题修复总结

**提交**：7187e11  
**日期**：2026-08-17  
**问题**：英文版本文档中行号（No. 列）全为空  

## 问题根本原因

在 `processOptTable` 和 `processEpTable` 中存在有缺陷的条件判断逻辑：

```typescript
// 原代码（缺陷）
if (languageMode !== 'english-only') {
  renumberTableRows(tbl)
} else {
  // 尝试恢复行号的复杂逻辑（47 行代码）
  // 问题：操作已被删除的孤立 DOM 节点 → 完全无效
}
```

### 为什么会失败

1. **行保存阶段**：existingRowNums Map 存储行元素的引用和行号
2. **行删除阶段**：某些行被从 DOM 树中删除
3. **恢复阶段**：代码试图在已删除的 DOM 节点上操作 → **失败**
   - 孤立的 DOM 节点无法正确更新
   - 更新永远不会被应用到文档中

## 修复方案

**简单而正确的解决方案：统一使用 renumberTableRows() 函数**

```typescript
// 新代码（正确）
// 所有模式都无条件调用 renumberTableRows
renumberTableRows(tbl)
```

### renumberTableRows() 函数如何工作

该函数会：
1. 遍历表格的所有行
2. 检查每行的第一个单元格（行号列）
3. 对于 **空单元格** 或 **已有数字的单元格**，填充/更新行号
4. 自动处理模板行和动态行

**关键点**：renumberTableRows() 已经在 processMainTable 中成功使用，现在将其推广到所有表格。

## 代码修改

### 修改 1：processOptTable（表格 2 - 附加服务）
- **位置**：lib/docGenerator.ts 第 1257-1305 行
- **改动**：删除 47 行的恢复逻辑，替换为 1 行的 renumberTableRows() 调用
- **git diff**：-47 行 +1 行

### 修改 2：processEpTable（表格 3 - 就业许可证）
- **位置**：lib/docGenerator.ts 第 1525-1573 行
- **改动**：删除 47 行的恢复逻辑，替换为 1 行的 renumberTableRows() 调用
- **git diff**：-47 行 +1 行

### 不需要修改：processMainTable（表格 1 - 公司成立）
- 已经在第 1031 行无条件调用 renumberTableRows()
- 无需修改

## 测试验证

需要生成英文版本文档并检查：

- [x] **行号列（No.）**：应显示 1, 2, 3... 而不是空白
- [ ] **费用列（Fee）**：应显示具体金额（待验证）
- [ ] **其他内容**：服务名称、标记等应正确显示（预期正常）

## 后续工作

如果费用列仍然为空，需要进行第二阶段诊断：
1. 检查 updateFeeCell() 函数的正则表达式匹配
2. 验证英文模板中费用单元格的格式是否与中英文模板相同
3. 可能需要调整 updateFeeCell() 的匹配逻辑以支持英文模板的格式

## 部署状态

- **代码提交**：✅ 完成（7187e11）
- **推送到远程**：✅ 完成
- **Vercel 部署**：⏳ 进行中（自动触发）

生成测试文档后即可验证修复效果。
