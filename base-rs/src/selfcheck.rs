//! 启动自检：边界成立的前提要能被证实，而不是希望它成立。
//! 自检不过时基座照常启动（健康检查要能回答），但拒绝开新回合，并说清缺什么。

use std::path::Path;
use std::process::Stdio;

use serde_json::{json, Value};

#[derive(Clone, Debug, Default)]
pub struct SelfCheck {
    pub problems: Vec<String>,
}

impl SelfCheck {
    pub fn ok(&self) -> bool {
        self.problems.is_empty()
    }

    pub fn to_json(&self) -> Value {
        json!({
            "ok": self.ok(),
            "problems": self.problems,
        })
    }

    /// 拒绝开回合时写进终态/接口的原因：一句话就够，不列设置项。
    pub fn refusal(&self) -> String {
        format!("基座自检没通过：{}；先修好再开回合", self.problems.join("；"))
    }
}

/// pi 必须接受扩展入口（`-e` / `--extension`）：不认就说明工具边界挂不上，
/// 一开回合等于让成员带着全部工具裸奔。`--help` 是能力问题，不是版本问题。
pub async fn pi_supports_extension_flag(bin: &Path) -> Result<(), String> {
    let mut command = crate::platform::command_for(bin);
    command
        .arg("--help")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    crate::platform::hide_window(&mut command);
    let output = command
        .output()
        .await
        .map_err(|error| format!("跑不了 {}：{error}", bin.display()))?;
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let supports = text.contains("--extension")
        || text.contains("-e,")
        || text.contains("-e ")
        || text.contains("-e\t");
    if supports {
        Ok(())
    } else {
        Err(format!(
            "{} 不认 -e / --extension；工具边界挂不上，回合一开就是全部工具可见",
            bin.display()
        ))
    }
}

/// fake 驱动不碰 pi、也不进沙箱，自检只针对真实驱动。
pub async fn run(fake: bool) -> SelfCheck {
    let mut problems = Vec::new();
    if fake {
        return SelfCheck { problems };
    }
    match crate::discovery::pi_binary() {
        Some(bin) => {
            if let Err(problem) = pi_supports_extension_flag(&bin).await {
                problems.push(problem);
            }
        }
        None => problems.push("找不到 pi 可执行文件".to_string()),
    }
    // 沙箱开着就必须真的立得起来：state() 是后端自己的回答，不是开关变量。
    let wanted = std::env::var("LODGE_SANDBOX")
        .map(|value| value != "off")
        .unwrap_or(true);
    if wanted && crate::sandbox::state() != "on" {
        problems.push("沙箱开着，但当前平台的后端立不起来".to_string());
    }
    SelfCheck { problems }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn script(dir: &Path, name: &str, body: &str) -> std::path::PathBuf {
        let path = dir.join(name);
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(body.as_bytes()).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = std::fs::metadata(&path).unwrap().permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&path, permissions).unwrap();
        }
        path
    }

    #[tokio::test]
    async fn a_help_without_the_extension_flag_is_refused() {
        let dir = std::env::temp_dir().join(format!("lodge-selfcheck-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let old = script(&dir, "pi", "#!/bin/sh\nprintf 'usage: pi [options]\\n  -m model\\n'\n");
        let new = script(&dir, "pi-new", "#!/bin/sh\nprintf 'usage: pi\\n  -e, --extension <file>  load an extension\\n'\n");
        assert!(pi_supports_extension_flag(&old).await.is_err());
        assert!(pi_supports_extension_flag(&new).await.is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
