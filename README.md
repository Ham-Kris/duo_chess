# duo_chess

本地双人 / Lc0 对弈的国际象棋页面。棋盘居中，设置在右侧栏。双人对局不依赖引擎；AI 模式需要本机已安装 [Leela Chess Zero (Lc0)](https://lczero.org/)。

## 环境

- Node.js 18+（本仓库用 `node server.js` 启动，无额外 npm 依赖）
- 可选：`lc0` 可执行文件（仅 AI 执黑 / AI 执白需要）

## 启动

在仓库根目录执行：

```bash
node server.js
```

浏览器打开 [http://127.0.0.1:4173/](http://127.0.0.1:4173/)。

可选环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `4173` | HTTP 端口 |
| `LC0_PATH` | `lc0` | Lc0 可执行文件路径。未在 `PATH` 里时再设 |

例如：

```bash
PORT=4173 LC0_PATH=/opt/homebrew/bin/lc0 node server.js
```

服务只监听 `127.0.0.1`。启动成功时终端会打印访问地址和当前使用的 Lc0 命令。

不要直接用 `file://` 打开 `index.html`：走子声音、静态资源和 `/api/bestmove` 都依赖这个本地服务。

## 使用

右侧「对局设置」：

- **重新开始**：恢复开局，白方先行。
- **自动翻转视角**：默认关闭。勾选后，轮到哪一方，棋盘在约 1 秒后切到该方视角（不是把棋盘旋转 180°）。
- **反转视角**：立刻切换当前视角。
- **双人对局**：双方都由当前浏览器操作。
- **AI 执黑**：你走白棋，Lc0 走黑棋。
- **AI 执白**：你走黑棋；此时默认视角为黑方。Lc0 开局后会先走。

走子：先点己方棋子，再点目标格。选中的棋子会放大。将死、逼和、子力不足、三次重复、五十步规则会自动结束对局，终局后不能再走，Lc0 也不会继续思考。

浅色 / 深色样式跟随系统主题。

侧边栏底部会显示 `双人对局`、`Lc0 待命`、`Lc0 正在思考`，或引擎报错（例如找不到 `lc0`）。

## 安装 Lc0

AI 模式会 `spawn` 名为 `lc0` 的进程（或 `LC0_PATH` 指向的文件），用 UCI 发送当前 FEN，并读取 `bestmove`。

### macOS（Homebrew）

```bash
brew install lc0
which lc0
lc0 --help
```

Homebrew 公式会安装引擎，并自带一份默认网络权重（与 `lc0` 放在同一 `libexec` 目录）。装好后确保 `which lc0` 有输出，再启动本仓库的 `node server.js`。

Apple Silicon 上常见路径是 `/opt/homebrew/bin/lc0`，Intel Mac 常见路径是 `/usr/local/bin/lc0`。

### Windows / Linux

1. 打开官方下载页：[https://lczero.org/play/download/](https://lczero.org/play/download/)，按硬件选择构建。
2. 解压。目录里应有引擎（Windows 为 `lc0.exe`）和一份 `*.pb.gz` 网络文件，两者放在同一目录。
3. 把该目录加入 `PATH`，或启动时指定绝对路径：

```bash
LC0_PATH="C:\path\to\lc0.exe" node server.js
```

```bash
LC0_PATH=/path/to/lc0 node server.js
```

官方入门说明：[https://lczero.org/play/quickstart/](https://lczero.org/play/quickstart/)。

### 检查是否可用

```bash
command -v lc0
lc0 --help
```

若终端出现 `未找到 Lc0，可设置 LC0_PATH 或把 lc0 加入 PATH`，说明 Node 进程找不到引擎：把 `lc0` 加入 `PATH`，或用 `LC0_PATH` 指向可执行文件后重新启动 `node server.js`。
