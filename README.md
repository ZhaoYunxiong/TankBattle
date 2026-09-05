# 山谷守卫 · Tank Battle

一款在网页里运行的几何风格 3D 坦克守卫战。穿过山林、炸开岩壁、收集补给，守护营地并击退五波敌军。

**[直接游玩](https://zhaoyunxiong.github.io/TankBattle/)**

支持电脑键鼠与手机触控，横屏、竖屏分别适配。所有模型由代码生成，音效由 Web Audio 合成，无需外部素材。

## 玩法

- 第三人称跟随镜头，自由旋转、俯仰和缩放；独立炮塔转速，准星显示实际射击方向。
- 坦克和营地均有血量，普通炮弹不会秒杀满血坦克；开火需要装填。
- 受损后冒烟、减速、精度下降，维修后恢复。
- 随机补给：快速装填、三连发、回血、强化装甲。
- 摧毁树木和岩壁打通捷径，敌军也会利用新路、攻击围墙。
- 五波攻势，普通、快速、重型三类敌人；两辆备用坦克及复活保护。
- 光影、后坐、爆炸碎片、距离衰减的镜头震动；支持画质和音效设置。
- 小地图、营地受袭提示、增益倒计时、暂停与胜负结算。

## 操作

| 功能 | 电脑 | 手机 |
| --- | --- | --- |
| 驾驶 | W/S 前进后退，A/D 转向 | 左摇杆上下前后、左右转向 |
| 瞄准 | 单击战场锁定鼠标，鼠标移动或拖动 | 右侧拖动 |
| 开火 | 按住左键或空格 | 按住开火按钮，也能同时拖动瞄准 |
| 镜头 | 滚轮缩放、C 归位、Alt 自由观察 | ＋/− 缩放，相机按钮切换自由观察 |
| 暂停 | Esc 或右上按钮 | 右上暂停按钮 |

## 手机联机

2～4 人合作。房主在手机网页中创建房间，其他人用六位房间号、二维码或邀请链接加入，准备完成后由房主开始战役。不需要电脑或安装服务器程序。

房主统一模拟敌军、命中、血量、补给与地图破坏，其他玩家提交输入并接收完整战场快照。每位玩家独立控制镜头，默认关闭队友和营地围墙的友军伤害。

### 网络与当前限制

- GitHub Pages 提供静态网页；多人配对使用 [PeerJS 公共服务](https://peerjs.com/server/cloud)，战场通过 WebRTC 同步。单人模式不依赖配对服务。
- 开房和加入需要能访问公共配对服务。同一允许设备互访的 Wi-Fi 更适合直连。
- **默认配置只有 STUN，没有部署可靠的公网 TURN 中继。不同运营商、移动数据、严格 NAT 或隔离网络可能无法直连。** 稳定跨网联机需要额外配置 TURN，GitHub Pages 本身无法提供中继。
- 房主切到后台时主动暂停战场；失去连接时队友显示等待提示。没有自动更换房主，房主离开会结束本局。
- 开战后只允许同一页面会话重连已有坦克，不支持新玩家中途加入。
- 尚未实现完全断网的游戏缓存与手动配对。
- 手机以新版 Android Chrome、iPhone Safari 为兼容目标。移动视口和多点触控自动化验证不等同于实体手机测试，内置浏览器的能力也可能不同。

## 开发与验证

使用 Node.js 24：

    npm ci
    npm run dev

打开 http://localhost:5173/TankBattle/ 。通过手机访问局域网 HTTP 调试地址时，部分安全上下文功能可能受限；完整功能请使用 HTTPS 站点。

    npm test
    npm run build
    npm run test:e2e

单元测试覆盖冷却、受损、回血、增益、复活、胜负、破坏后寻路和输入边界。浏览器测试覆盖桌面驾驶/开火/暂停、手机横竖屏、多指操作，以及两个独立会话的真实 WebRTC 战场同步。

Windows 测试使用本机 Edge；其他平台先执行 npx playwright install chromium。完整联机测试会访问公共配对服务。CI 运行无需外部配对服务的浏览器测试，截图保存在 Actions 工件中。

可安装 Playwright WebKit，并设置 TANK_TEST_BROWSER=webkit，单独运行名称含“WebKit 手机”的测试。发布后运行 node scripts/check-published.mjs，检查公开页面的单人流程、手机布局与实际双会话联机。

## 部署

推送 main 后，GitHub Actions 自动测试、构建并发布。Settings → Pages → Source 设为 **GitHub Actions**。生产路径为 /TankBattle/，产物在 dist/；更换站点路径时同步修改 vite.config.ts。

可选构建环境变量：

| 变量 | 用途 |
| --- | --- |
| VITE_PEER_HOST | 自建 PeerServer 的 HTTPS 域名，默认使用公共服务 |
| VITE_PEER_PORT | 服务端口，默认 443 |
| VITE_PEER_PATH | 服务路径，默认 / |
| VITE_ICE_SERVERS | 自定义 RTCIceServer 数组 JSON，接入 STUN/TURN |

本地变量可放在未提交的 .env.local。VITE_ 变量会进入公开网页，不能存放长期私密凭证。生产 TURN 应由后端签发短期凭证。

## 结构

    src/game/simulation.ts   固定步长战斗模拟与敌军 AI
    src/game/world.ts        可复现地图、碰撞和 A* 导航
    src/game/renderer.ts     Babylon.js 场景、坦克、光影和粒子
    src/game/audio.ts        合成音效
    src/network.ts           手机房间和战场快照同步
    src/controls.ts          键鼠、多点触控和自由镜头
    src/main.ts              大厅、设置、战场 HUD 和游戏流程
    tests/                  战斗规则与浏览器验证

项目采用 MIT 许可证，详见 [LICENSE](LICENSE)。
