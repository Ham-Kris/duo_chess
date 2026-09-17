# duo_chess

本地双人 / AI 对弈的国际象棋页面。棋盘居中，设置在右侧栏。双人对局不依赖引擎；AI 模式优先使用 [Leela Chess Zero (Lc0)](https://lczero.org/)，找不到或启动失败时回退到 Stockfish。

## 环境

- Node.js 18+（本仓库用 `node server.js` 启动，无额外 npm 依赖）
- 可选：`lc0` 或 `stockfish` 可执行文件（仅 AI 执黑 / AI 执白需要）

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
| `HOST` | `127.0.0.1` | HTTP 监听地址；直接对外提供服务时可设为 `0.0.0.0` |
| `AUTH_FILE` | 仓库根目录下的 `auth.json` | 访问账号配置文件路径 |
| `LC0_PATH` | `lc0` | Lc0 可执行文件路径。未在 `PATH` 里时再设 |
| `STOCKFISH_PATH` | `stockfish` | Stockfish 可执行文件路径。Lc0 不可用时作为回退 |

例如：

```bash
HOST=127.0.0.1 PORT=4173 LC0_PATH=/opt/homebrew/bin/lc0 STOCKFISH_PATH=/opt/homebrew/bin/stockfish node server.js
```

服务默认只监听 `127.0.0.1`；设置 `HOST=0.0.0.0` 后可监听所有 IPv4 地址。启动成功时终端会打印访问地址和当前 UCI 引擎顺序。默认顺序固定为 Lc0 -> Stockfish。

不要直接用 `file://` 打开 `index.html`：走子声音、静态资源和 `/api/bestmove` 都依赖这个本地服务。

## 访问保护

首次启动时没有 `auth.json`，网页可以直接访问。在右侧「访问保护」中设置账号和至少 8 位密码后，服务会创建 `auth.json`；之后访问网页和业务 API 都必须先登录。

密码使用带随机 salt 的 `PBKDF2-HMAC-SHA256` 保存，不会写入明文。登录状态保存在仅服务端可识别的随机会话中，浏览器 Cookie 有效期为 7 天。点击「退出登录」会立即清除当前会话。

`auth.json` 已加入 `.gitignore`。如需关闭访问保护，停止服务后删除该文件并重新启动。可通过 `AUTH_FILE` 把配置保存到其他位置：

```bash
AUTH_FILE=/path/to/duo-chess-auth.json node server.js
```

认证检查：

```bash
node --test auth.test.js
```

## 使用

右侧「对局设置」：

- **重新开始**：恢复开局，白方先行。
- **自动翻转视角**：默认关闭。勾选后，轮到哪一方，棋盘在约 1 秒后切到该方视角（不是把棋盘旋转 180°）。
- **反转视角**：立刻切换当前视角。
- **双人对局**：双方都由当前浏览器操作。
- **AI 执黑**：你走白棋，AI 走黑棋。
- **AI 执白**：你走黑棋；此时默认视角为黑方。AI 开局后会先走。

走子：先点己方棋子，再点目标格。选中的棋子会放大。将死、逼和、子力不足、三次重复、五十步规则会自动结束对局，终局后不能再走，AI 也不会继续思考。

浅色 / 深色样式跟随系统主题。

侧边栏底部会显示 `双人对局`、`AI 待命（优先 Lc0）`、`AI 正在思考`，或引擎报错（例如找不到 `lc0` 和 `stockfish`）。

## 安装引擎

AI 模式会按顺序尝试 `lc0`（或 `LC0_PATH` 指向的文件）和 `stockfish`（或 `STOCKFISH_PATH` 指向的文件），用 UCI 发送当前 FEN，并读取 `bestmove`。只要 Lc0 可用就会优先使用 Lc0。

## 安装 Lc0

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

## 安装 Stockfish

Stockfish 只是回退引擎；如果 Lc0 可用，服务端仍会优先调用 Lc0。

### macOS（Homebrew）

```bash
brew install stockfish
which stockfish
stockfish
```

若 `stockfish` 不在 `PATH` 中，启动时指定绝对路径：

```bash
STOCKFISH_PATH=/opt/homebrew/bin/stockfish node server.js
```

### Windows / Linux

1. 打开官方下载页：[https://stockfishchess.org/download/](https://stockfishchess.org/download/)，按系统下载构建。
2. 解压并确认目录里有 `stockfish` 或 `stockfish.exe`。
3. 把该目录加入 `PATH`，或启动时指定绝对路径：

```bash
STOCKFISH_PATH="C:\path\to\stockfish.exe" node server.js
```

```bash
STOCKFISH_PATH=/path/to/stockfish node server.js
```
