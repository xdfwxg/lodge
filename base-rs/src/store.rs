//! SQLite 持久化：bot、群、事件、回合、用量、卡、租约。
//! 基座只存执行状态；房间、阶段、证据不在这个库里。

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use crate::model::{Lease, TurnUsage};

/// 写失败必须能被调用方看见；读失败按空结果处理，写失败向上抛。
pub type StoreResult<T> = Result<T, String>;

fn db<T>(result: rusqlite::Result<T>) -> StoreResult<T> {
    result.map_err(|error| error.to_string())
}

pub struct Store {
    conn: Mutex<Connection>,
    /// 附件和文件的落盘目录：跟数据库放在一起，换库就换目录。
    dir: std::path::PathBuf,
    /// 事件落库失败过；/api/health 会报告 degraded，不假装一切正常。
    degraded: std::sync::atomic::AtomicBool,
}

#[derive(Clone, Debug)]
pub struct RunningTurn {
    pub thread_id: String,
    pub bot_id: String,
    pub turn_id: String,
}

#[derive(Clone, Debug)]
pub struct CardRow {
    pub request_id: String,
    pub thread_id: String,
    pub bot_id: String,
    pub turn_id: String,
    pub tool: String,
    pub lease_id: Option<String>,
    pub payload: Value,
}

impl Store {
    /// 连接锁只防并发写；持锁线程 panic 过也继续用同一份连接，不把整个基座拖死。
    fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        // 另一个进程（只读排查、第二个实例）短暂占锁时等一会儿，不把一次请求变成 500。
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS bots (
                id TEXT PRIMARY KEY,
                thread_id TEXT NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS groups (
                id TEXT PRIMARY KEY,
                thread_id TEXT NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS events (
                id TEXT PRIMARY KEY,
                thread_id TEXT NOT NULL,
                seq INTEGER NOT NULL UNIQUE,
                at INTEGER NOT NULL,
                kind TEXT NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS events_thread ON events(thread_id, seq);
            CREATE TABLE IF NOT EXISTS usage (
                turn_id TEXT PRIMARY KEY,
                thread_id TEXT NOT NULL,
                bot_id TEXT NOT NULL,
                input INTEGER NOT NULL,
                output INTEGER NOT NULL,
                cache_read INTEGER NOT NULL,
                at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS turns (
                thread_id TEXT PRIMARY KEY,
                bot_id TEXT NOT NULL,
                turn_id TEXT NOT NULL,
                state TEXT NOT NULL,
                started_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS cards (
                request_id TEXT PRIMARY KEY,
                thread_id TEXT NOT NULL,
                bot_id TEXT NOT NULL,
                turn_id TEXT NOT NULL,
                tool TEXT NOT NULL,
                lease_id TEXT,
                payload TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS leases (
                id TEXT PRIMARY KEY,
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS skills (
                name TEXT PRIMARY KEY,
                text TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 0,
                at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS bot_skills (
                bot_id TEXT NOT NULL,
                name TEXT NOT NULL,
                PRIMARY KEY (bot_id, name)
            );
            CREATE TABLE IF NOT EXISTS attachments (
                name TEXT PRIMARY KEY,
                mime TEXT NOT NULL,
                original TEXT NOT NULL,
                bytes INTEGER NOT NULL,
                at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS mcp_servers (
                name TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                at INTEGER NOT NULL
            );
            "#,
        )?;
        Ok(Self {
            conn: Mutex::new(conn),
            dir: path.parent().map(|parent| parent.to_path_buf()).unwrap_or_default(),
            degraded: std::sync::atomic::AtomicBool::new(false),
        })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    // ---- attachments ----

    /// 附件只认基座生成的 uuid 文件名；原始文件名单独存，显示和下载都靠它。
    pub fn save_attachment(&self, name: &str, mime: &str, original: &str, bytes: i64) -> StoreResult<()> {
        let conn = self.conn();
        db(conn.execute(
            "INSERT OR REPLACE INTO attachments (name, mime, original, bytes, at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![name, mime, original, bytes, now()],
        ))?;
        Ok(())
    }

    pub fn attachment(&self, name: &str) -> StoreResult<Option<(String, String, i64)>> {
        let conn = self.conn();
        db(conn
            .query_row(
                "SELECT mime, original, bytes FROM attachments WHERE name = ?1",
                params![name],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?)),
            )
            .optional())
    }

    pub fn degraded(&self) -> bool {
        self.degraded.load(std::sync::atomic::Ordering::SeqCst)
    }

    pub fn last_seq(&self) -> u64 {
        let conn = self.conn();
        match conn.query_row("SELECT COALESCE(MAX(seq), 0) FROM events", [], |row| row.get::<_, i64>(0)) {
            Ok(value) => value.max(0) as u64,
            Err(error) => {
                eprintln!("lodge-base-slice: 读事件序号失败: {error}");
                0
            }
        }
    }

    /// 按全局 seq 读事件：SSE 断线超出环形缓冲时从存储补齐。
    pub fn events_after(&self, seq: u64, limit: usize) -> Vec<(u64, Value)> {
        let conn = self.conn();
        let Ok(mut statement) = conn.prepare(
            "SELECT seq, payload FROM events WHERE seq > ?1 ORDER BY seq LIMIT ?2",
        ) else {
            return Vec::new();
        };
        let rows = statement.query_map(
            rusqlite::params![seq as i64, limit as i64],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        );
        let Ok(rows) = rows else {
            return Vec::new();
        };
        rows.flatten()
            .filter_map(|(seq, text)| {
                serde_json::from_str::<Value>(&text).ok().map(|frame| (seq.max(0) as u64, frame))
            })
            .collect()
    }

    // ---- bots ----

    pub fn bots(&self) -> StoreResult<Vec<Value>> {
        let conn = self.conn();
        let mut stmt = db(conn.prepare("SELECT payload FROM bots ORDER BY rowid ASC"))?;
        let rows = db(stmt.query_map([], |row| row.get::<_, String>(0)))?;
        let texts = rows
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?;
        parse_rows(texts)
    }

    pub fn bot(&self, id: &str) -> StoreResult<Option<Value>> {
        let conn = self.conn();
        let row = db(conn
            .query_row(
                "SELECT payload FROM bots WHERE id = ?1",
                params![id],
                |row| row.get::<_, String>(0),
            )
            .optional())?;
        row.map(parse_json).transpose()
    }

    pub fn upsert_bot(&self, bot: &Value) -> StoreResult<()> {
        let Some(id) = bot.get("id").and_then(Value::as_str) else {
            return Err("bot 缺少 id".to_string());
        };
        let thread_id = bot.get("threadId").and_then(Value::as_str).unwrap_or("");
        let text = serde_json::to_string(bot).map_err(|error| error.to_string())?;
        let conn = self.conn();
        db(conn.execute(
            "INSERT INTO bots (id, thread_id, payload) VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET thread_id = excluded.thread_id, payload = excluded.payload",
            params![id, thread_id, text],
        ))?;
        Ok(())
    }

    pub fn delete_bot(&self, id: &str) -> StoreResult<()> {
        let conn = self.conn();
        db(conn.execute("DELETE FROM bots WHERE id = ?1", params![id]))?;
        Ok(())
    }

    // ---- groups ----

    pub fn groups(&self) -> StoreResult<Vec<Value>> {
        let conn = self.conn();
        let mut stmt = db(conn.prepare("SELECT payload FROM groups ORDER BY rowid ASC"))?;
        let rows = db(stmt.query_map([], |row| row.get::<_, String>(0)))?;
        let texts = rows
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?;
        parse_rows(texts)
    }

    pub fn group_by_thread(&self, thread_id: &str) -> StoreResult<Option<Value>> {
        let conn = self.conn();
        let row = db(conn
            .query_row(
                "SELECT payload FROM groups WHERE thread_id = ?1 LIMIT 1",
                params![thread_id],
                |row| row.get::<_, String>(0),
            )
            .optional())?;
        row.map(parse_json).transpose()
    }

    pub fn group(&self, id: &str) -> StoreResult<Option<Value>> {
        let conn = self.conn();
        let row = db(conn
            .query_row(
                "SELECT payload FROM groups WHERE id = ?1",
                params![id],
                |row| row.get::<_, String>(0),
            )
            .optional())?;
        row.map(parse_json).transpose()
    }

    pub fn upsert_group(&self, group: &Value) -> StoreResult<()> {
        let Some(id) = group.get("id").and_then(Value::as_str) else {
            return Err("群缺少 id".to_string());
        };
        let thread_id = group.get("threadId").and_then(Value::as_str).unwrap_or("");
        let text = serde_json::to_string(group).map_err(|error| error.to_string())?;
        let conn = self.conn();
        db(conn.execute(
            "INSERT INTO groups (id, thread_id, payload) VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET thread_id = excluded.thread_id, payload = excluded.payload",
            params![id, thread_id, text],
        ))?;
        Ok(())
    }

    pub fn delete_group(&self, id: &str) -> StoreResult<()> {
        let conn = self.conn();
        db(conn.execute("DELETE FROM groups WHERE id = ?1", params![id]))?;
        Ok(())
    }

    // ---- events ----

    pub fn append_event(
        &self,
        id: &str,
        thread_id: &str,
        seq: u64,
        at: i64,
        kind: &str,
        frame: &Value,
    ) -> StoreResult<()> {
        let text = serde_json::to_string(frame).map_err(|error| {
            self.degraded.store(true, std::sync::atomic::Ordering::SeqCst);
            error.to_string()
        })?;
        let conn = self.conn();
        let result = db(conn.execute(
            "INSERT OR REPLACE INTO events (id, thread_id, seq, at, kind, payload)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, thread_id, seq as i64, at, kind, text],
        ));
        if result.is_err() {
            self.degraded.store(true, std::sync::atomic::Ordering::SeqCst);
        }
        result?;
        Ok(())
    }

    pub fn thread_messages(&self, thread_id: &str, limit: usize) -> StoreResult<Vec<Value>> {
        let conn = self.conn();
        let limit = limit.clamp(1, 5000) as i64;
        let mut stmt = db(conn.prepare(
            "SELECT payload FROM events WHERE thread_id = ?1 AND kind = 'message'
             ORDER BY seq DESC LIMIT ?2",
        ))?;
        let rows = db(stmt.query_map(params![thread_id, limit], |row| row.get::<_, String>(0)))?;
        let mut texts = rows
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?;
        // 查询是倒序取最近 N 条；对外仍按时间正序。
        texts.reverse();
        texts
            .into_iter()
            .map(|text| {
                let frame = parse_json(text)?;
                frame
                    .get("message")
                    .cloned()
                    .ok_or_else(|| "事件缺少 message".to_string())
            })
            .collect()
    }

    // ---- turns ----

    pub fn start_turn(&self, thread_id: &str, bot_id: &str, turn_id: &str) -> StoreResult<()> {
        let now = now();
        let conn = self.conn();
        db(conn.execute(
            "INSERT INTO turns (thread_id, bot_id, turn_id, state, started_at, updated_at)
             VALUES (?1, ?2, ?3, 'running', ?4, ?4)
             ON CONFLICT(thread_id) DO UPDATE SET
               bot_id = excluded.bot_id, turn_id = excluded.turn_id,
               state = 'running', started_at = excluded.started_at, updated_at = excluded.updated_at",
            params![thread_id, bot_id, turn_id, now],
        ))?;
        Ok(())
    }

    /// 崩溃可能发生在 digest 已落库、turns 行还没更新之间；恢复前先看账本。
    pub fn turn_has_digest(&self, thread_id: &str, turn_id: &str) -> StoreResult<bool> {
        let conn = self.conn();
        let count: i64 = db(conn.query_row(
            "SELECT COUNT(*) FROM events
             WHERE thread_id = ?1 AND kind = 'message'
               AND json_extract(payload, '$.message.digest.turnId') = ?2",
            params![thread_id, turn_id],
            |row| row.get(0),
        ))?;
        Ok(count > 0)
    }

    /// digest 的 durationMs 是这个回合真正的耗时：终态账本里只存起点，不存一个假的 0。
    pub fn turn_started_at(&self, thread_id: &str, turn_id: &str) -> StoreResult<Option<i64>> {
        use rusqlite::OptionalExtension;
        let conn = self.conn();
        db(conn
            .query_row(
                "SELECT started_at FROM turns WHERE thread_id = ?1 AND turn_id = ?2",
                params![thread_id, turn_id],
                |row| row.get::<_, i64>(0),
            )
            .optional())
    }

    /// 只结束这一回合的行；线程上已经有新回合时不能误改它。
    pub fn end_turn(&self, thread_id: &str, turn_id: &str, state: &str) -> StoreResult<()> {
        let conn = self.conn();
        db(conn.execute(
            "UPDATE turns SET state = ?3, updated_at = ?4 WHERE thread_id = ?1 AND turn_id = ?2",
            params![thread_id, turn_id, state, now()],
        ))?;
        Ok(())
    }

    /// 启动时把没结束的回合标成 failed；返回它们，由基座补终态。
    pub fn recover_running(&self) -> Vec<RunningTurn> {
        let conn = self.conn();
        let mut stmt = match conn.prepare(
            "SELECT thread_id, bot_id, turn_id FROM turns WHERE state = 'running'",
        ) {
            Ok(stmt) => stmt,
            Err(error) => {
                eprintln!("lodge-base-slice: 读未完成回合失败: {error}");
                return Vec::new();
            }
        };
        let rows = match stmt.query_map([], |row| {
            Ok(RunningTurn {
                thread_id: row.get(0)?,
                bot_id: row.get(1)?,
                turn_id: row.get(2)?,
            })
        }) {
            Ok(rows) => rows,
            Err(error) => {
                eprintln!("lodge-base-slice: 读未完成回合失败: {error}");
                return Vec::new();
            }
        };
        let list = match rows.collect::<rusqlite::Result<Vec<_>>>() {
            Ok(list) => list,
            Err(error) => {
                eprintln!("lodge-base-slice: 读未完成回合失败: {error}");
                return Vec::new();
            }
        };
        for turn in &list {
            if let Err(error) = db(conn.execute(
                "UPDATE turns SET state = 'failed', updated_at = ?2 WHERE thread_id = ?1",
                params![turn.thread_id, now()],
            )) {
                eprintln!("lodge-base-slice: 恢复回合失败: {error}");
            }
        }
        list
    }

    // ---- usage ----

    pub fn record_usage(
        &self,
        turn_id: &str,
        thread_id: &str,
        bot_id: &str,
        usage: &TurnUsage,
    ) -> StoreResult<()> {
        let conn = self.conn();
        db(conn.execute(
            "INSERT OR REPLACE INTO usage (turn_id, thread_id, bot_id, input, output, cache_read, at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                turn_id,
                thread_id,
                bot_id,
                usage.input as i64,
                usage.output as i64,
                usage.cache_read as i64,
                now()
            ],
        ))?;
        Ok(())
    }

    // ---- cards ----

    pub fn save_card(&self, card: &CardRow) -> StoreResult<()> {
        let text = serde_json::to_string(&card.payload).map_err(|error| error.to_string())?;
        let conn = self.conn();
        db(conn.execute(
            "INSERT OR REPLACE INTO cards (request_id, thread_id, bot_id, turn_id, tool, lease_id, payload, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                card.request_id,
                card.thread_id,
                card.bot_id,
                card.turn_id,
                card.tool,
                card.lease_id,
                text,
                now()
            ],
        ))?;
        Ok(())
    }

    pub fn take_card(&self, request_id: &str) -> StoreResult<Option<CardRow>> {
        let conn = self.conn();
        let row = db(conn
            .query_row(
                "SELECT request_id, thread_id, bot_id, turn_id, tool, lease_id, payload
                 FROM cards WHERE request_id = ?1",
                params![request_id],
                |row| {
                    let payload: String = row.get(6)?;
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, Option<String>>(5)?,
                        payload,
                    ))
                },
            )
            .optional())?;
        let Some(row) = row else { return Ok(None) };
        db(conn.execute("DELETE FROM cards WHERE request_id = ?1", params![request_id]))?;
        Ok(Some(CardRow {
            request_id: row.0,
            thread_id: row.1,
            bot_id: row.2,
            turn_id: row.3,
            tool: row.4,
            lease_id: row.5,
            payload: serde_json::from_str(&row.6).unwrap_or(Value::Null),
        }))
    }

    pub fn delete_cards_for_turn(&self, turn_id: &str) -> StoreResult<()> {
        let conn = self.conn();
        db(conn.execute("DELETE FROM cards WHERE turn_id = ?1", params![turn_id]))?;
        Ok(())
    }

    // ---- leases ----

    pub fn save_lease(&self, lease: &Lease) -> StoreResult<()> {
        let text = serde_json::to_string(lease).map_err(|error| error.to_string())?;
        let conn = self.conn();
        db(conn.execute(
            "INSERT OR REPLACE INTO leases (id, payload) VALUES (?1, ?2)",
            params![lease.id, text],
        ))?;
        Ok(())
    }

    pub fn lease(&self, id: &str) -> StoreResult<Option<Lease>> {
        let conn = self.conn();
        let row = db(conn
            .query_row(
                "SELECT payload FROM leases WHERE id = ?1",
                params![id],
                |row| row.get::<_, String>(0),
            )
            .optional())?;
        row.map(|text| serde_json::from_str::<Lease>(&text).map_err(|error| error.to_string()))
            .transpose()
    }

    // ---- skills ----

    /// 技能库是基座里的正文，不解释角色；名字来自 SKILL.md 的前言，由 HTTP 层解析。
    pub fn skills(&self) -> StoreResult<Vec<(String, bool)>> {
        let conn = self.conn();
        let mut stmt = db(conn.prepare("SELECT name, enabled FROM skills ORDER BY name"))?;
        let rows = db(stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? != 0))
        }))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())
    }

    pub fn skill(&self, name: &str) -> StoreResult<Option<(String, bool)>> {
        let conn = self.conn();
        let row = db(conn
            .query_row(
                "SELECT text, enabled FROM skills WHERE name = ?1",
                params![name],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? != 0)),
            )
            .optional())?;
        Ok(row)
    }

    /// 同名技能不覆盖：基座里已有的版本是真相，升级由人处理。
    pub fn insert_skill(&self, name: &str, text: &str) -> StoreResult<bool> {
        let conn = self.conn();
        let changed = db(conn.execute(
            "INSERT OR IGNORE INTO skills (name, text, enabled, at) VALUES (?1, ?2, 0, ?3)",
            params![name, text, now()],
        ))?;
        Ok(changed > 0)
    }

    /// 删掉一份技能：调用方（Lodge 的角色包）负责随后按新正文重新导入。
    pub fn delete_skill(&self, name: &str) -> StoreResult<bool> {
        let conn = self.conn();
        let changed = db(conn.execute("DELETE FROM skills WHERE name = ?1", params![name]))?;
        Ok(changed > 0)
    }

    pub fn set_skill_enabled(&self, name: &str, enabled: bool) -> StoreResult<bool> {
        let conn = self.conn();
        let changed = db(conn.execute(
            "UPDATE skills SET enabled = ?2 WHERE name = ?1",
            params![name, if enabled { 1 } else { 0 }],
        ))?;
        Ok(changed > 0)
    }

    /// 整体替换：技能面是一次声明，不是增删流水。
    pub fn set_bot_skills(&self, bot_id: &str, skills: &[String]) -> StoreResult<()> {
        let mut conn = self.conn();
        let tx = db(conn.transaction())?;
        db(tx.execute("DELETE FROM bot_skills WHERE bot_id = ?1", params![bot_id]))?;
        for name in skills {
            db(tx.execute(
                "INSERT OR IGNORE INTO bot_skills (bot_id, name) VALUES (?1, ?2)",
                params![bot_id, name],
            ))?;
        }
        db(tx.commit())?;
        Ok(())
    }

    /// 成员挂了哪些技能：只读投影，写入口是上面的整体替换。
    pub fn bot_skills(&self, bot_id: &str) -> StoreResult<Vec<String>> {
        let conn = self.conn();
        let mut stmt = db(conn.prepare("SELECT name FROM bot_skills WHERE bot_id = ?1 ORDER BY name"))?;
        let rows = db(stmt.query_map(params![bot_id], |row| row.get::<_, String>(0)))?;
        Ok(db(rows.collect::<rusqlite::Result<Vec<_>>>())?)
    }

    // ---- MCP servers ----

    /// MCP 服务器是基座的接入配置：名字 + 启动方式；谁挂哪些由 bot 的设置决定。
    pub fn mcp_servers(&self) -> StoreResult<Vec<Value>> {
        let conn = self.conn();
        let mut stmt = db(conn.prepare("SELECT payload FROM mcp_servers ORDER BY name"))?;
        let rows = db(stmt.query_map([], |row| row.get::<_, String>(0)))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?
            .into_iter()
            .map(parse_json)
            .collect()
    }

    pub fn mcp_server(&self, name: &str) -> StoreResult<Option<Value>> {
        let conn = self.conn();
        let row = db(conn
            .query_row(
                "SELECT payload FROM mcp_servers WHERE name = ?1",
                params![name],
                |row| row.get::<_, String>(0),
            )
            .optional())?;
        row.map(parse_json).transpose()
    }

    pub fn put_mcp_server(&self, server: &Value) -> StoreResult<()> {
        let name = server
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(|| "MCP 服务器缺少名字".to_string())?;
        let text = serde_json::to_string(server).map_err(|error| error.to_string())?;
        let conn = self.conn();
        db(conn.execute(
            "INSERT OR REPLACE INTO mcp_servers (name, payload, at) VALUES (?1, ?2, ?3)",
            params![name, text, now()],
        ))?;
        Ok(())
    }

    pub fn delete_mcp_server(&self, name: &str) -> StoreResult<bool> {
        let conn = self.conn();
        let changed = db(conn.execute("DELETE FROM mcp_servers WHERE name = ?1", params![name]))?;
        Ok(changed > 0)
    }

    /// 回合开始时要注入的技能正文：只取这个 bot 分到、且已启用的。
    /// 这个成员分到的技能：名字和正文。名字用来列清单、按需读；正文不再整段塞进提示词。
    pub fn bot_skill_pairs(&self, bot_id: &str) -> StoreResult<Vec<(String, String)>> {
        let conn = self.conn();
        let mut stmt = db(conn.prepare(
            "SELECT skills.name, skills.text FROM bot_skills
             JOIN skills ON skills.name = bot_skills.name
             WHERE bot_skills.bot_id = ?1 AND skills.enabled = 1
             ORDER BY skills.name",
        ))?;
        let rows = db(stmt.query_map(params![bot_id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())
    }
}

fn parse_json(text: String) -> StoreResult<Value> {
    serde_json::from_str(&text).map_err(|error| error.to_string())
}

fn parse_rows(texts: Vec<String>) -> StoreResult<Vec<Value>> {
    texts.into_iter().map(parse_json).collect()
}

pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("lodge-store-test-{}.db", uuid::Uuid::new_v4()))
    }

    fn cleanup(path: &Path) {
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn a_second_process_waits_instead_of_failing_at_once() {
        let path = std::env::temp_dir().join(format!("lodge-busy-{}.db", uuid::Uuid::new_v4()));
        let store = Store::open(&path).unwrap();
        let timeout: i64 = store
            .conn()
            .query_row("PRAGMA busy_timeout", [], |row| row.get(0))
            .unwrap();
        assert_eq!(timeout, 5000, "锁被短暂占用时应等待，不立刻报 500");
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn events_survive_reopen_and_keep_their_ids() {
        let path = temp_db();
        {
            let store = Store::open(&path).unwrap();
            store.append_event(
                "m1",
                "t1",
                1,
                10,
                "message",
                &serde_json::json!({"kind":"message","threadId":"t1","message":{"id":"m1","text":"hi"}}),
            ).unwrap();
            store.append_event(
                "m2",
                "t1",
                2,
                11,
                "message",
                &serde_json::json!({"kind":"message","threadId":"t1","message":{"id":"m2","text":"again"}}),
            ).unwrap();
        }
        let store = Store::open(&path).unwrap();
        assert_eq!(store.last_seq(), 2);
        let messages = store.thread_messages("t1", 1000).unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["id"], "m1");
        assert_eq!(messages[1]["text"], "again");
        cleanup(&path);
    }

    #[test]
    fn a_running_turn_is_recovered_once() {
        let path = temp_db();
        let store = Store::open(&path).unwrap();
        store.start_turn("t1", "b1", "turn-1").unwrap();
        let running = store.recover_running();
        assert_eq!(running.len(), 1);
        assert_eq!(running[0].turn_id, "turn-1");
        assert!(store.recover_running().is_empty());
        cleanup(&path);
    }
}
