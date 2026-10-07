# duo_chess

本地 AI 辅助对局的国际象棋页面。双方由用户操作，AI 为当前行棋方提供最优和次优落点，并显示双方攻击范围。引擎优先使用 [Leela Chess Zero (Lc0)](https://lczero.org/)，找不到或启动失败时回退到 Stockfish。棋规使用本地 vendored 的 `chess.js@1.4.0`。

## 环境

- Node.js 18+（本仓库用 `node server.js` 启动，无额外 npm 依赖）
- 可选：`lc0` 或 `stockfish` 可执行文件（AI 辅助分析需要）

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

## 一键部署到 FS

在本地仓库执行（会部署当前文件，包括未提交的修改）：

```bash
bash deploy.sh
```

默认使用 SSH 配置中的 `FS`，也可执行 `bash deploy.sh SSH_HOST` 指定主机。
SSH 采用交互式连接，关闭 agent forwarding；需要时请完成 1Password 授权。

脚本针对已配置好的 Linux/systemd 服务器：目标为 `/www/wwwroot/duo_chess`，
服务为 `duo-chess.service`，端口为 `8900`。需要 root、Node.js 18+、curl、
tar 和 flock。缺少 `/usr/games/stockfish` 时通过 apt 安装 Stockfish。
现有服务须配置 `PORT=8900`、`STOCKFISH_PATH=/usr/games/stockfish` 和
`AUTH_FILE=/var/lib/duo-chess/auth.json`。

部署前运行认证测试，只上传应用文件和资源；账号密码文件保持原位。
旧版本保留在 `/www/wwwroot/duo_chess.backup-*`。重启后检查本机认证状态和
`https://chess.pathwit.com/login`；失败时恢复旧版本并重启服务，失败版本保留在
`/www/wwwroot/duo_chess.failed-*` 供排查。回滚只恢复应用，不卸载已安装的 Stockfish。
重启会清除内存中的登录会话，需要重新登录。脚本不配置反向代理或首次创建 systemd 服务。

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

- **自定义棋局**：从当前局面编辑，可清空或恢复标准摆法。选择棋子后点击格子放置或替换，使用移动／删除工具调整位置；编辑期间暂停 AI，取消后保留原对局。
- **摆子数量**：每方王最多 1、兵最多 8，总数最多 16。后最多 9，车／象／马各最多 10；超出初始数量的后／车／象／马共用 `8 − 当前兵数` 个升变额度。开局后的正常升变不受编辑限制。
- **自定义先手**：可选白方或黑方，与棋盘视角无关，默认白方。开始前要求双方各一个王、王不相邻、兵不在第 1／8 横线、非行棋方未被将军。自定义开局不保留王车易位或吃过路兵权，计步重新开始。
- **重新开始**：恢复本局起点和先手；自定义对局恢复自定义摆法。撤销最多退回本局起点。「标准新局」恢复标准开局、白方先行。
- **反转视角**：立刻切换当前视角。
- **AI 辅助对局**：双方都由当前浏览器操作，AI 为当前行棋方显示最优和次优推荐。
- **胜率估计**：显示白胜、和棋、黑胜概率，使用引擎原生 WDL；引擎报告强制将死（`score mate`）或已经进入终局时显示 100% / 0%。普通局面是概率估计，不保证实际结果。
- **劣势时优先争取和棋**：界面会按当前棋盘视角显示为“白方”或“黑方”，布尔选项 `preferDraw`，默认关闭。视角一方轮到行棋且胜率低于 20%、负率高于胜率时，分析最多 8 条候选线路，优先选择和棋概率更高的着法；不增加负率，也不牺牲超过 2 个百分点的胜率。直接获胜优先于求和。逼和、重复局面、子力不足和五十步规则均算和棋。
- **攻击线**：可分别显示或隐藏白方、黑方的攻击范围。选中或悬停棋子时会突出该棋子的线路。
- **升变**：兵到达底线后选择后、车、象或马；按 `Esc` 或取消可返回原局面。

走子：先点己方棋子，再点目标格。选中的棋子会放大。将死、逼和、子力不足、三次重复、五十步规则会自动结束对局，终局后不能再走，AI 也不会继续思考。

浅色 / 深色样式跟随系统主题。

侧边栏会显示分析引擎、最优和次优推荐，或引擎报错（例如找不到 `lc0` 和 `stockfish`）。

## 安装引擎

AI 模式会按顺序尝试 `lc0`（或 `LC0_PATH` 指向的文件）和 `stockfish`（或 `STOCKFISH_PATH` 指向的文件），用 UCI 发送起始 FEN 和合法棋步历史，并读取 `bestmove` 与 WDL。接口中的 `history` 为 `{ startFen, moves: ["e2e4", ...] }`，服务端验证回放结果与 `fen` 一致；仅传 FEN 的旧请求仍可用，但无法识别之前的重复局面。只要 Lc0 可用就会优先使用 Lc0。

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
