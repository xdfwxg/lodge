#!/usr/bin/env node
// 一个“不认 -e”的 pi：自检要能当场拒绝开回合，而不是等到扩展没加载才发现。
// 只有 --help 有意义；真跑起来就立刻退出，测试不该走到这一步。
const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write('usage: pi [options]\n  -m, --model <id>   model\n  --mode <mode>      rpc|interactive\n')
  process.exit(0)
}
process.stderr.write('fake pi: 这个假 pi 只用来验证启动自检\n')
process.exit(1)
