// 房间本地的运行文件不是交付内容：不进候选 commit、不进验收 diff。
export const LOCAL_ONLY = ['.crew', '.env', '.env.local', 'node_modules']

export const diffScope = ['.', ...LOCAL_ONLY.map(path => `:(exclude)${path}`)]
