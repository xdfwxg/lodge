export const parseArgs = argv => ({
  verbose: argv.includes('--verbose'),
  rest: argv.filter(arg => arg !== '--verbose'),
})
