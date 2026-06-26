# TokenGate 参赛截图任务 · 交给本地 Claude 执行

> 这份文件可以直接整段复制粘贴到本地 Claude(具备屏幕截图 / 浏览器操作 / 文件读写能力的版本)。
> 它会自动完成"准备数据 → 截 6 张图 → 命名 → 归档"的全过程。

---

## 任务背景

我用 TRAE IDE 开发了一个本机 token 消耗管家叫 **TokenGate**,要参加 **TRAE AI 创造力大赛**。
初赛 Demo 帖要求**至少 3 张关键步骤截图**(我打算上 6 张)。

项目位置:`/Users/xiebaole/TRAE FOR LIFE/tokengate/`
启动命令:`cd tokengate && npm start`(同时拉起前端 5173 + 后端 8787)
访问地址:`http://localhost:5173/`

---

## 你要做的事(总览)

1. **环境检查与启动**:确认服务在跑(5173 / 8787),没跑就 `npm start` 拉起
2. **准备演示数据**:建 2 个 mock provider、curl 几次造数据、设一个低预算
3. **截 6 张关键截图**,保存到 `/Users/xiebaole/TRAE FOR LIFE/tokengate/screenshots/`,严格命名
4. 完成后给我一份简短中文总结(每张截了什么、文件名)

---

## 第一步:环境准备

### 1.1 检查服务是否在跑

```bash
curl -s http://127.0.0.1:5173/ -o /dev/null -w "%{http_code}\n"
curl -s http://127.0.0.1:8787/api/providers -o /dev/null -w "%{http_code}\n"
```

两条都返回 200 = OK,跳到 1.2。
任何一条不通,在新终端执行:

```bash
cd "/Users/xiebaole/TRAE FOR LIFE/tokengate"
npm start
```

等到日志出现 `http://localhost:5173/` 和 `TokenGate 本地后端:http://127.0.0.1:8787` 再继续。

### 1.2 创建截图目录

```bash
mkdir -p "/Users/xiebaole/TRAE FOR LIFE/tokengate/screenshots"
```

---

## 第二步:准备演示数据(让图表有内容、有故事)

按顺序执行以下 curl 命令(都在本机后端 8787 跑)。

### 2.1 建一个用于演示的 Mock Provider A(国外模型为主)

```bash
curl -s -X POST http://127.0.0.1:8787/api/providers \
  -H 'Content-Type: application/json' \
  -d '{"name":"OpenAI 主号","baseUrl":"http://127.0.0.1:8787/api/_mock","category":"国外","plan":"按量 $50","quotaUsd":50,"models":["gpt-4o","gpt-4o-mini","claude-3-5-sonnet"]}'
```

记下返回的 `provider.id`,设为变量 `PID_A`。

### 2.2 建第二个 Mock Provider B(国内模型为主,演示双币种)

```bash
curl -s -X POST http://127.0.0.1:8787/api/providers \
  -H 'Content-Type: application/json' \
  -d '{"name":"DeepSeek 主号","baseUrl":"http://127.0.0.1:8787/api/_mock","category":"国内","plan":"充值 ¥100","quotaUsd":14,"models":["deepseek-chat","deepseek-reasoner"]}'
```

记下 `provider.id`,设为 `PID_B`。

### 2.3 制造 10 笔不同模型的消耗(让排行榜/对比图有料)

```bash
# 国外 provider 的几个模型
for m in gpt-4o gpt-4o-mini claude-3-5-sonnet gpt-4o; do
  curl -s -X POST "http://127.0.0.1:8787/proxy/$PID_A/v1/chat/completions" \
    -H 'Content-Type: application/json' \
    -d "{\"model\":\"$m\",\"messages\":[{\"role\":\"user\",\"content\":\"$(printf 'x%.0s' {1..200})\"}]}" > /dev/null
done

# 国内 provider 演示更便宜
for m in deepseek-chat deepseek-reasoner deepseek-chat deepseek-chat; do
  curl -s -X POST "http://127.0.0.1:8787/proxy/$PID_B/v1/chat/completions" \
    -H 'Content-Type: application/json' \
    -d "{\"model\":\"$m\",\"messages\":[{\"role\":\"user\",\"content\":\"$(printf 'y%.0s' {1..300})\"}]}" > /dev/null
done
```

### 2.4 设置一个会被触发的预算(用于截"拦截"那张图)

打开浏览器到 `http://localhost:5173/` → 「预算与闸门」标签 → 加一条:**整体上限 $0.01**(故意设得低,这样下一次录入就会触发拦截)。
或者直接 curl(如果有对应 API,没找到就走 UI):

```bash
# 如果有预算 API 端点的话用这条,没有就用 UI 设
curl -s -X POST http://127.0.0.1:8787/api/budgets \
  -H 'Content-Type: application/json' \
  -d '{"scope":"global","limitUsd":0.01}' 2>/dev/null || echo "用 UI 设"
```

---

## 第三步:截 6 张截图

**通用要求**:
- 浏览器窗口宽度建议 ≥ 1400px,确保驾驶舱多列布局完整可见
- 暗色主题(TokenGate 默认就是)
- 不要把整个屏幕都截了,只截**浏览器内容区**就行
- 截图分辨率:推荐 2x(retina),清晰为主

### 截图 1 · 驾驶舱首页全貌

**文件名**:`/Users/xiebaole/TRAE FOR LIFE/tokengate/screenshots/01-dashboard.png`

**操作**:
1. 浏览器打开 `http://localhost:5173/`,确保停在「总览」标签
2. 滚动到页面**最顶部**
3. 截图区域:整个浏览器内容区(从顶部品牌栏到至少包含"消耗趋势 · 近 14 天"这张大图)

**画面里必须能看到**:
- 顶部"检测到的 AI 工具"模块(至少 6 张工具卡)
- 6 项指标带(累计花费 / 近 7 天 / 总 token / 输入输出 / 调用笔数 / 涉及项目)
- 14 天大趋势图(Emerald 面积线 + token 柱)

### 截图 2 · 各 API 模块化 + 模型排行榜

**文件名**:`02-provider-cards-and-rank.png`

**操作**:
1. 在「总览」标签,**向下滚动**到能同时看见:
   - 「各 API 模块 · 实时计量」区(显示两张 provider 迷你卡 OpenAI 主号 / DeepSeek 主号 各带 sparkline)
   - 「模型 Token 排行榜」区
2. 截这一屏

**画面里必须能看到**:
- 两张 provider 迷你卡(各自带花费数字 + sparkline + 剩余额度条)
- 模型排行榜 Top 几名 + 横向输入/输出对比条

### 截图 3 · 接入与监听(provider 卡 + 代理地址 + 验证 ✓)

**文件名**:`03-providers-page.png`

**操作**:
1. 点顶部 tab「接入与监听」
2. 截当前页面

**画面里必须能看到**:
- 「OpenAI 主号」「DeepSeek 主号」两张卡片
- 卡片上的代理地址(形如 `http://127.0.0.1:8787/proxy/<id>/v1`)+ 复制按钮
- 如果有"✓ 已验证"绿色徽章更好

### 截图 4 · 预算闸拦截弹窗(灵魂功能!)

**文件名**:`04-budget-gate-block.png`

**操作**:
1. 确认「预算与闸门」里设了 **整体上限 $0.01**
2. 切到「记一笔」标签
3. 填写一笔大消耗(会超过 $0.01):
   - 模型:`gpt-4o`
   - input tokens:`500`
   - output tokens:`5000`
   - 项目:`测试拦截`
4. 点保存 → **会弹出拦截对话框**
5. 趁弹窗在屏幕上时立即截图

**画面里必须能看到**:
- 拦截弹窗本体,清晰看到 "已用 $X + 本次 $Y > 上限 $0.01" 这条信息
- "批准超额放行" 和 "取消" 两个按钮

**截完之后**:点取消,不要真的放行(避免污染数据)。

### 截图 5 · 流水与闸门记录(留痕)

**文件名**:`05-records-and-gate-log.png`

**操作**:
1. 切到「流水与闸门」标签
2. 滚动到能同时看到:
   - 上半部:消耗流水(每笔 token、模型、花费)
   - 下半部:闸门记录(刚才那次"已拦截"的留痕)

**画面里必须能看到**:
- 多条流水记录(至少 5-8 行)
- 闸门记录里至少 1 条拦截痕迹,带时间戳

### 截图 6 · AI 管家页面

**文件名**:`06-butler-local-llm.png`

**操作**:
1. 切到「AI 管家」标签
2. 截当前页面

**画面里必须能看到**:
- 顶部本地模型探测状态(绿灯/红灯都行)
- 大脑切换下拉(可见本地模型 + 云端模型选项)
- 4 个快捷问题按钮
- "数据不出门"或"隐私承诺"相关文案徽章

---

## 第四步:归档与确认

### 4.1 检查所有截图都存在

```bash
ls -lh "/Users/xiebaole/TRAE FOR LIFE/tokengate/screenshots/"
```

应该看到 6 个 PNG,每个 100KB ~ 2MB 都正常。

### 4.2 给我一份中文小结

按下面格式回复:

```
✓ 6 张截图已就位:

01-dashboard.png            — 驾驶舱首页,展示了 X 个 AI 工具卡 + 6 项指标 + 14 天大图
02-provider-cards-and-rank.png — 两张 provider 迷你卡 + 模型 token 排行榜
03-providers-page.png       — 接入页,两个 provider + 代理地址 + ✓ 已验证
04-budget-gate-block.png    — 灵魂功能:预算拦截弹窗,"已用 $X + 本次 $Y > 上限 $0.01"
05-records-and-gate-log.png — 流水 + 闸门记录留痕(共 N 条流水 + 1 条拦截)
06-butler-local-llm.png     — AI 管家,本地探测状态 + 快捷问题 + 隐私徽章

存放目录:/Users/xiebaole/TRAE FOR LIFE/tokengate/screenshots/

如有任何一张拍得不理想,告诉我哪一张,我重截。
```

---

## 注意事项

- **不要**改任何源代码,只是截图
- **不要**真的点"批准超额放行"那个按钮(第 4 张截完后点取消)
- **不要**用 macOS 截整个屏幕(包括 Dock / 菜单栏),只截浏览器内容区
- 如果浏览器还没有数据(刚启动),先把第二步的 curl 都跑完再开始截图
- 如果遇到 6 个工具卡都没显示("还没有数据"),说明扫描 API 没返回,刷新一下页面或检查 8787 是否在跑

完成。
