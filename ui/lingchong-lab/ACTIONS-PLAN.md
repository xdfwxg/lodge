# 朏朏 · 后续动作实现方案

> 状态：**打哈欠已实现**（见 `index.html`）；**趴下睡觉 / 追蝴蝶仍仅方案、未实现**。
> 覆盖三个动作：**打哈欠 / 趴下睡觉 / 追蝴蝶**。本文件把坐标、状态机、代码骨架、坑点和验证清单写全，后续两个动作可直接照此实施。

### 打哈欠的实现记录（与下方方案的差异）
- `startYawn()` 无参数：因睡觉未实现，去掉了 `bedtime` / `goSleep()`；哈欠结束只 `setTag('呼～')`。
- 自动触发保留（待机 20–28 s 一次）；`plan()` / `petPet()` / `roam` / `reset` 统一用 `stopYawn()` 打断，代替方案里的 `wakeUp()` / `cancelChase()`。
- 「到蒲团歇着」联动**未做**，留到睡觉一起实现。
- 新按钮 `#yawnBtn`「打个哈欠」；页头说明补了一句；哈欠期间冻结 `idleT`，避免标签被回落逻辑覆盖。
- ⚠️ 实测坑：`#blink` 的两个 rect 原本是纯白 `#ffffff`，随机眨眼只闪 130 ms 看不出，但哈欠全程眯眼会变成两块显眼的「白眼罩」。已改成与线稿填充一致的纸色 `#f8f3ea`，**后续两个动作直接沿用这个颜色**。
- 验证：Chrome 逐帧截图（待机 / 张嘴 / 峰值 / 闭合）、控制台 0 报错、`node --test` 8/8、指令打断后 A\* 正常重算（探 41 格）。

---

## 0. 现状与坐标基准

### 文件
| 文件 | 作用 |
| --- | --- |
| `ui/lingchong-lab/index.html` | 自包含演示页（线稿以 base64 内嵌于 `#artSource`，运行时写入 `--art`），**唯一需要改的文件** |
| `ui/lingchong-lab/lingchong-ink.png` | 派生墨线稿：白填充换成纸色、线条加深。**必须继续用它**，否则切片旋转会重现「灰袜子 / 白色三角」 |
| `ui/src/assets/lingchong-standing.png` | 原始线稿，仅作参照 |
| `ui/src/goal-island/pathfinder.js` + `.test.js` | 可复用 A\* 模块，本轮**不需要改** |

### 线稿实测坐标（原图 385×195）
| 部位 | 坐标 |
| --- | --- |
| 头部轮廓 | x 95–185, y 8–75 |
| 两眼 | (118, 47)、(157, 47)；`#blink` 两个 rect 为 (101,41,36,24)、(137,41,36,24) |
| 原小嘴「ω」 | x 120–133, y 50–60，中心 ≈ (127, 56) |
| 下颌线 | y ≈ 72–75 |
| 两耳 | x 98–118 / 155–180, y 8–30 |
| 腹线 / 腿根 | y = 138（四条腿 clip 的 inset 上沿） |
| 四腿 transform-origin | (123,138) (161,138) (224,138) (272,138) |
| 尾巴 | x > 288, y < 140，origin (285,95) |
| 躯干 | x 60–292, y 0–140，origin (195,140) |
| 脚点 | y = 165（常量 `AY`），`S = 0.46`、`AX = 195` |

> ⚠️ **这是正脸，不是侧脸**。两只眼睛都在前面，`flip` 的 `scaleX(-1)` 只是镜像，并不等于「转身」。追蝴蝶章节会专门处理这个视觉约定。

### 现有架构要点
- `pet` 单一状态对象；`pet.state` 只有 `'idle' | 'walk'`；`frame(now)` 是唯一的 rAF 主循环，每帧覆写 `#body` / `#tail` / 四腿 / `#flip` / `#pet` 的 `transform`。
- `plan()` 走 A\*、`arrive()` 结束、`petPet()` 摸头；`drawOverlay()` 画网格 / 探索格 / 路径虚线 / 目标圈，只在事件时重画。
- 层级：`art-tail 1 < legs 2 < art-body 3 < blink 4 < pet-tag 7 < sparks 8`；`#flip` 承载朝向，`#sparks` 在 `flip` 外（不会被镜像）。

---

## 通用设计原则（三个动作都遵守）

1. **不重画角色**：继续「同一张线稿 + 裁切窗口」，新增视觉一律叠 SVG，不引入新位图。
2. **不要往 `pet.state` 里塞新值**（会与 A\* 的移动逻辑打架），改用独立布尔 / 计时器字段：
   ```js
   // 追加到 pet 对象
   yawnT: 0, yawnDur: 1.5, bedtime: false, yawnTimer: 20 + Math.random()*8,
   sleeping: false, sleepMix: 0, sleepT: 0,
   chase: null, butterfly: null, sleepOnArrive: false, lastPlan: 0
   ```
3. **姿态用 0→1 插值逐帧写 transform**（`sleepMix` / `stretch` / `sm`），**不要**给 `#body`、`#tail`、`[data-leg]` 加 CSS `transition` —— 它们每帧被 JS 覆写，过渡会拖成卡顿。
4. **用户指令优先级最高**：在 `plan()` 开头统一 `wakeUp()` + `cancelChase()`；`petPet()`、`roam`、`reset`、点地面都自然唤醒。
5. 新增层级建议：`blink 4 < yawn 5 < butterfly 5 < pet-tag 7 < sparks 8 < zzz 9`。蝴蝶与 Zzz 放 `#flip` 外，避免被朝向镜像。
6. `prefers-reduced-motion` 下缩短 Zzz / 振翅动画。

---

## 一、打哈欠

### 视觉
在 `#blink` 之后、`#sparks` 之前插入：
```html
<svg class="lingchong-yawn" id="yawn" viewBox="0 0 385 195" aria-hidden="true">
  <g id="yawnMouth">
    <path d="M116 53 q11 -5 22 0 q-1 19 -11 19 q-10 0 -11 -19z"
          fill="#3e362d" stroke="#332c22" stroke-width="1.3"/>
    <path d="M120 66 q7 -9 14 0 q-7 6 -14 0z" fill="#d98a86"/>
    <path d="M117 53 q10 2 20 0" fill="none" stroke="#f8f3ea" stroke-width="1.4"/>
  </g>
</svg>
```
- CSS：`.lingchong-yawn{position:absolute;inset:0;width:385px;height:195px;z-index:5;pointer-events:none;opacity:0}`、`.on{opacity:1}`、`#yawnMouth{transform-origin:127px 58px}`。
- 椭圆区域 x 116–138 / y 48–72 必须**完整盖住原来的小 ω 嘴**，否则会出现两张嘴。
- 伴随：眯眼（复用 `#blink.on` 常显）、头微抬（`body` `rotate(+2.5°)`）、身体拉长（`scaleX 1.03`）、两条前腿前伸（额外 `rotate(-18°)`）、尾巴轻竖 `+8°`。

### 时序（1.5 s）
```js
const k = 1 - pet.yawnT / pet.yawnDur                 // 0 → 1
const open = Math.min(1, k * 4, (1 - k) * 3)          // 快张 → 保持 → 快合
const ease = open * open * (3 - 2 * open)
mouthEl.style.transform =
  `translateY(${(2*ease).toFixed(1)}px) scale(${(0.35+0.65*ease).toFixed(3)}, ${(0.08+0.92*ease).toFixed(3)})`
const stretch = Math.sin(k * Math.PI)                 // 伸懒腰包络
```
`yawnT` 归零：移除 `#yawn.on` / `#blink.on`；`bedtime` 为真 → `goSleep()`，否则 `setTag('呼～')` 并重置 `yawnTimer = 24 + Math.random()*12`。

### 触发
- 按钮 `#yawnBtn`「打个哈欠」→ `startYawn(false)`。
- 待机自动：`yawnTimer` 仅在 `!walking && !sleeping && !roaming && yawnT <= 0 && !bedtime` 时递减；归零 → `startYawn(true)`（打完就困，顺势趴下）或只打哈欠。**初值建议 20–28 s**，避免刚打开页面就睡着让人误以为卡死。
- 联动：`plan()` 中 `pet.sleepOnArrive = label.includes('蒲团')`；`arrive()` 末尾 `if (pet.sleepOnArrive) startYawn(true)` —— 「到蒲团歇着」自然变成打哈欠再睡。

### 函数骨架
```js
const startYawn = (thenSleep = false) => {
  if (pet.sleeping) return
  cancelChase()
  pet.yawnT = pet.yawnDur; pet.bedtime = thenSleep
  pet.state = 'idle'; pet.path = []; pet.goal = null; pet.idleT = 0
  roaming = false; $('roam').setAttribute('aria-pressed', 'false')
  yawnEl.classList.add('on'); blinkEl.classList.add('on')
  setTag('啊——困了…'); drawOverlay()
}
```

---

## 二、趴下睡觉

### 姿态：全部由 `sleepMix` 插值（趴下 ≈ 0.7 s，起身 ≈ 0.6 s）
```js
const sm = pet.sleepMix * pet.sleepMix * (3 - 2 * pet.sleepMix)   // smoothstep
```
| 层 | 变换 |
| --- | --- |
| `#flip` | `scale(1 + .05*sm, 1 - .22*sm) translateY(18*sm px)`，与朝向 `scaleX(-1)` 组合。origin 是 (192.5, 97.5)，脚原在 y=165，压扁后上移约 17px，用 +18px 补回贴地 |
| 四腿 | 收进腹下：`rot = a*(1-sm) + tuckA*sm`，`tuckA = [-68, 68, 62, -62]`；`scaleY = 1 - .74*sm`；`translateY = -lift*(1-sm) + 7*sm`。**顺序固定** `rotate() translateY() scaleY()`（局部先缩短再绕腿根转） |
| `#body` | `rotate(-5*sm)` 让左侧的头下沉、`translateY(6*sm)`；呼吸改慢而深 `1 + sin(t*1.0)*.014*sm` |
| `#tail` | `sin(tail)*amp*(1-sm) + (-22 + sin(tail*.5)*2)*sm`，搭到身侧 |
| `#blink` | `.on` 常显（闭眼） |
| `bob` | 乘 `(1 - sm)` |

### Zzz
`.zzz-field` 与 `#sparks` 同级、**在 `#flip` 外**（否则会被朝向镜像），z-index 9，`.on` 控制 `opacity` + `.6s` 过渡。三个 `.zzz` 字号 15 / 19 / 24，局部位置 (168,26) / (182,18) / (196,10)，`animation-delay: 0 / .9 / 1.8s`：
```css
@keyframes zzz-float{
  0%{opacity:0;transform:translate(0,8px) scale(.72) rotate(-10deg)}
  20%{opacity:.9}72%{opacity:.45}
  100%{opacity:0;transform:translate(22px,-48px) scale(1.16) rotate(8deg)}
}
```
`#tag` 显示「趴下 · 呼呼…」，状态栏沿用现有 label。

### 状态冲突（两个必踩的坑）
1. **冻结 `pet.idleT`**：睡着时不递增。否则主循环第 ~429 行的标签回落逻辑会把「趴下 · 呼呼…」覆盖成「待机 · 呼吸」，且可能触发 roaming 自动漫游。
2. **眨眼定时器守卫**：随机眨眼的 `setTimeout(() => blinkEl.classList.remove('on'), 130)` 会把睡时的闭眼擦掉，改成：
   ```js
   setTimeout(() => { if (!pet.sleeping && pet.yawnT <= 0) blinkEl.classList.remove('on') }, 130)
   ```

### 唤醒
```js
const wakeUp = () => {
  if (!pet.sleeping && !pet.yawnT && !pet.bedtime) return
  pet.sleeping = false; pet.bedtime = false; pet.yawnT = 0; pet.idleT = 0
  pet.yawnTimer = 18 + Math.random() * 10
  zzzEl.classList.remove('on'); yawnEl.classList.remove('on'); blinkEl.classList.remove('on')
  $('sleepBtn').setAttribute('aria-pressed', 'false')
  setTag('醒啦 · 抖抖毛'); drawOverlay()
}
```
`plan()` 开头调用 → 点地面 / 所有目标按钮自然唤醒；`petPet()` 也调用（点灵宠＝叫醒 + 呼噜 + 小花）；`roam` 开启、`reset`、`shuffle` 重算路径时同样唤醒。

### 按钮
`#sleepBtn`「趴下睡觉」，睡着后文案变「叫醒」（`aria-pressed` 同步）：点击 → `startYawn(true)`（先哈欠再趴下），再点 → `wakeUp()`。

---

## 三、追蝴蝶（最复杂，最后做）

### 蝴蝶实体
- 不新增位图：在 `stage` 内、`#pet` **外**加 `<div id="butterfly">`（绝对定位，z-index 5），内联 SVG 画双翅 + 触角；翅膀用 `@keyframes flap` 做 `scaleX(.25) ↔ 1`，周期 ≈ 0.18 s。
- 运动用 Lissajous 游走，**不走 A\***（蝴蝶在空中，不进障碍网格）：
  ```js
  b.t += dt
  b.x = clamp(b.cx + 92*Math.sin(b.t*.9) + 34*Math.sin(b.t*2.3), 30, W-30)
  b.y = clamp(b.cy + 46*Math.cos(b.t*1.3) + 20*Math.sin(b.t*2.7), 40, H-40) - 26
  ```
  每 4–7 s 随机换锚点 `(cx, cy)`；偶尔停在某个 spot 上方轻扇翅。朝向由速度方向算 `atan2(dy, dx)`（SVG 默认朝上时要 +90°）。可在地面加一个淡椭圆影子随 x 移动。
- `b.el.style.transform = translate(x,y) rotate(deg)`，只改 transform，不要每帧 `innerHTML`。

### 追逐状态机
`pet.chase = { phase: 'seek' | 'pounce' | 'cooldown', t: 0, misses: 0 }`，进 chase 前先 `wakeUp()`；与 sleeping / yawn 互斥。

| 阶段 | 行为 |
| --- | --- |
| `seek` | 每 ~0.45 s 用现有 `astar(pet, butterfly)` 重算路径（复用 `plan` 的路径部分，但 `setTag('追蝴蝶 · 蝶儿别跑')`）。**节流**：`now - lastPlan > 450 && 目标移动 > 28px` 才重算，否则抖动。速度 `78 * speedFactor * 1.25`，步幅 `amp = 25` |
| `pounce` | 距离 < 46px 时扑跃：`hopT = .55, hopH = 26`，`body rotate(-9°)`，两条前腿同时前伸 `rotate(-32°)`，尾巴上扬 `+18°`，`setTag('扑！')`，复用 `sparks` 撒 3–4 个 ✦。蝴蝶受惊：立刻换锚点并 1.6 倍速 1.2 s |
| `cooldown` | 扑完 1.2 s 回 seek；连续扑空 3 次或总时长 > 18 s → `setTag('算了 · 喘口气')`，清 chase 回 idle，蝴蝶继续飞但不再被追 |
| 命中（可选） | 距离 < 30px 且处于扑跃最高点 → `setTag('逮着啦 · 得意')`、`happyT = 2`、蝴蝶暂隐 3 s 后从新位置出现 |

### ⚠️ 三个必须注意的坑
1. **`arrive()` 守卫**：seek 复用 `state = 'walk'`，每次路径走完 `arrive()` 都会误触发「到啦 · 摇尾巴」并弹跳。必须在 `arrive()` 开头加：
   ```js
   if (pet.chase) { pet.state = 'walk'; return }
   ```
   这是最容易漏的一处。
2. **朝向**：线稿是正脸，`scaleX(-1)` 只是镜像，追蝴蝶时看起来仍像「正对观众平移」。
   - **方案 A（推荐，省事）**：接受这个视觉约定，靠 `body rotate(±3°)` 倾斜 + 蝴蝶方向暗示追逐感。
   - **方案 B（真实但费工）**：另画一张侧面线稿 `lingchong-side.png`，`dir > 0` 时切换 `--art`；**所有 clip-path 坐标要按新图重标一遍**，积分有限时不建议。
3. **事件冒泡**：蝴蝶元素 `pointerdown` 要 `stopPropagation()`（点蝴蝶＝吓跑它），否则会同时触发 `stage` 的 `plan()` 让灵宠走到点击处。

### 交互与耦合
- 面板加 `#chaseBtn`「放蝴蝶 / 收蝴蝶」（`aria-pressed`）：开启 → 生成蝴蝶 + `pet.chase`，关闭 → 移除蝴蝶、清 chase 回 idle。
- 任何 `plan()` 都要 `cancelChase()`，避免两套路径互相打架；chase 期间强制关掉 roaming。
- `drawOverlay()`：chase 的路径虚线改淡金 `#c69a54` + 降透明度，和用户指令的赭红 `#ad573f` 区分。
- `rebuildBlocked()` 与蝴蝶无关，不需要重算。

---

## 四、落地顺序与验证清单

1. 先做 `wakeUp()` + 状态字段 + `#yawn` SVG（改动最小，可独立验证）。
2. 再做 `sleepMix` 姿态插值 + Zzz + 按钮；**重点验证「睡着时点地面能立刻醒且正常寻路」**。
3. 最后做蝴蝶（新实体 + chase 状态机 + `arrive()` 守卫）。
4. 每步用 Chrome + Playwright 逐帧截图：哈欠张嘴帧、趴下稳定帧、扑跃帧；放大 2–3 倍检查切片接缝（历史问题：灰袜子、白色三角、蒲团穿过身体，纸色填充已修好，别把 `--art` 换回原稿）。
5. `node --test ui/src/goal-island/lingchong.test.js ui/src/goal-island/pathfinder.test.js` 确认 8/8 不回归；控制台 0 报错；640px 窄屏自适应。
6. 性能：rAF 里不要每帧写大段 `innerHTML`；蝴蝶只改 `transform`；`drawOverlay` 保持现有「仅事件时重画」的节流。
7. 可选：把状态机纯函数（如 `yawnCurve(k)`、`smoothstep(x)`、`chasePhase()`）抽成 `actions.js` + `actions.test.js`（约 5 个用例），便于回归。

### 预估改动量
| 动作 | 文件 | 大致行数 |
| --- | --- | --- |
| 打哈欠 | `index.html` | CSS ~12 / SVG ~5 / JS ~45 |
| 趴下睡觉 | `index.html` | CSS ~16 / SVG ~4 / JS ~55 |
| 追蝴蝶 | `index.html` | CSS ~20 / SVG ~10 / JS ~110 |

> 只改 `ui/lingchong-lab/index.html` 一个文件即可，`pathfinder.js` 不用动。
> 若要把动作接回 React 组件 `ui/src/goal-island/lingchong.js`，属于另一轮工作（那个是 96×58 的一维小岛组件，clip 坐标需整体缩放约 0.25，且没有 A\* 场景）。
