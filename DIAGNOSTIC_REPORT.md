# 英文模板生成问题诊断与修复记录

## 问题陈述
生成的英文版本文档中：
- ❌ "No." 列全部为空（应显示 1, 2, 3...）
- ❌ "Fee(SGD)" 列全部为空（应显示具体费用）
- ✓ 服务名称正常显示
- ✓ F.O.C. 项目的标记显示正常

## 根本原因分析需要检查
1. **模板文件问题**：新模板 EN vs CNEN 的结构差异
2. **行号填充逻辑**：renumberTableRows() 是否正确工作
3. **费用更新逻辑**：updateFeeCell() 是否被调用
4. **行删除逻辑**：rowLinked() 是否误删了需要保留的行
5. **模板选择逻辑**：generateDocx() 是否加载了正确的模板

## 修复步骤记录
### 步骤 1: 深度分析 generateDocx 中的模板选择
- 位置：lib/docGenerator.ts ~1887
- 当前逻辑：
  ```
  languageMode === 'english-only' ? 'Tassure_Proposal_EN.docx' : 'Tassure_Proposal_CNEN.docx'
  ```
- 需要验证：两个模板的实际行结构是否完全相同

### 步骤 2: 检查 renumberTableRows() 逻辑
- 位置：lib/docGenerator.ts ~657
- 问题可能：如果行号单元格最初为空，renumberTableRows() 不会填充它们
- 需要修复：确保对空单元格也能填充行号

### 步骤 3: 检查费用更新逻辑
- 位置：lib/docGenerator.ts ~processMainTable ~800+
- 问题可能：updateFeeCell() 是否被正确调用
- 需要验证：所有行都被处理，不只是特定行

### 步骤 4: 验证行删除逻辑
- 位置：lib/docGenerator.ts ~777-790
- 当前：english-only 模式下禁用行删除
- 需要确认：所有行都被保留

## 修复计划
1. 对比两个模板的实际结构（行数、单元格格式）
2. 修改 renumberTableRows() 确保能处理空单元格
3. 验证 updateFeeCell() 被正确调用
4. 测试英文版本生成

## 真正的根本原因（经代码审查发现）

### 发现 1：renumberTableRows() 在 english-only 模式下被禁用
- **代码位置**：processOptTable 第 1258-1260 行
- **当前逻辑**：
  ```typescript
  if (languageMode !== 'english-only') {
    renumberTableRows(tbl)  // 只在 bilingual 模式下调用
  }
  ```
- **后果**：英文模板中的行号永远不会被填充

### 发现 2：恢复逻辑试图使用已删除的 DOM 节点
- **代码位置**：processOptTable 第 1262 行
- **问题**：
  1. 第 1125-1139 行：保存行号到 existingRowNums Map
  2. 第 1257-1292 行：尝试恢复这些行
  3. **缺陷**：Map 中保存的是行元素的引用，但在删除行逻辑中，这些元素可能已从 DOM 中移除
  4. **结果**：操作孤立的 DOM 节点，完全无效

### 发现 3：费用更新逻辑可能也有问题
- **代码位置**：processMainTable 第 795-862 行
- **问题**：updateFeeCell() 函数使用正则表达式查找 "SGD " + 数字的模式
- **隐患**：如果英文模板的费用单元格格式与中英文模板不同，匹配可能失败

## 根本原因
英文模板结构与中英文模板完全不同（16 行 vs 13 行），但代码对两个模板使用同样的处理流程，只是禁用了某些环节。这导致：
1. **行号不显示**：renumberTableRows() 被禁用
2. **费用不显示**：updateFeeCell() 的正则匹配可能失效
3. **恢复逻辑失效**：操作已删除或孤立的 DOM 节点

## 修复进度

### 第一阶段：行号填充修复 ✅ 已完成
- [x] **processOptTable** (第 1257-1305 行)
  - **修改**：移除有缺陷的条件判断 `if (languageMode !== 'english-only')`
  - **修改前**：英文模式下尝试恢复行号（操作孤立 DOM 节点，完全无效）
  - **修改后**：所有模式都无条件调用 `renumberTableRows(tbl)`
  - **代码变化**：删除 47 行的复杂恢复逻辑，替换为 1 行的 renumberTableRows() 调用
  
- [x] **processEpTable** (第 1525-1573 行)
  - **修改**：删除相同的有缺陷恢复逻辑
  - **代码变化**：删除 47 行的复杂恢复逻辑，替换为 1 行的 renumberTableRows() 调用

- [x] **processMainTable** (第 1031 行)
  - **无需修改**：已经无条件调用 renumberTableRows(tbl)

### 第二阶段：费用填充验证 ⏳ 待验证
- [ ] updateFeeCell() 函数逻辑检查
  - 当前已验证：第 155 行正确处理 languageMode 参数
  - 待验证：英文模板中费用单元格的实际格式是否匹配正则表达式

### 测试验证
- [ ] 生成英文文档，检查行号（No. 列）是否填充
- [ ] 检查费用（Fee 列）是否填充
- [ ] 检查格式是否正确

## 代码修改总结
- **文件**：lib/docGenerator.ts
- **修改次数**：2 次（processOptTable 和 processEpTable）
- **删除行数**：94 行（两个有缺陷的恢复逻辑）
- **新增行数**：2 行（两个 renumberTableRows() 调用）
- **核心变化**：从复杂的条件恢复逻辑改为统一的行号填充方案
