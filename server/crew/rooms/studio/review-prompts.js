import { INTERNAL_PROMPT_MARKER } from '../../internal-prompts.js'
import { VERDICT_JSON_HINT } from '../../../../shared/judgment.js'
import { fenceUntrusted } from '../../../../shared/untrusted-text.js'

export const VERDICT_FORMAT = `如果工具列表里有 submit_verdict，直接调用它提交判定；工具不可用时才按文本回复。第一行写 PASS 或 REJECT，紧接着一句结论（不超过 50 字，说清结果是否达标）。${VERDICT_JSON_HINT}题面没写到的边界，挑一两个最能打穿规则的输入复核（例如 Unicode 标点、空串、连续符号）；发现问题直接 REJECT 并给证据。命令和退出码卡片已经显示，不要再复述。`

export const REVIEW_REMINDER_PROMPT = `复核还没有结论。请现在调用 submit_verdict 提交判定；没有这个工具就只回复一行 PASS 或 REJECT。不要继续调研。\n${INTERNAL_PROMPT_MARKER}`

export const VERDICT_RETRY_PROMPT = `你这一回合没有提交判定。现在只做一件事：调用 lodge_gate_submit_verdict 提交 PASS 或 REJECT；工具确实不可用时只回复一行 PASS 或 REJECT。不要继续调研，也不要改文件。\n${INTERNAL_PROMPT_MARKER}`

// 证据、命令输出和 diff 都可能带外部内容；去隐藏字符、按字符预算截断，再用围栏包住。
export const untrusted = (text, lang = '', max = 4000) => fenceUntrusted(text, { lang, max })
