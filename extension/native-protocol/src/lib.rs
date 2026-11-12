use serde::{Deserialize, Serialize};
use std::io::{self, Read, Write};
pub const HOST: &str = "io.invibe.annyong.youtube";
pub const LIMIT: usize = 8192;
#[cfg(windows)]
pub mod pipe;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Observation {
    pub kind: String,
    pub video_id: Option<String>,
    pub title: String,
    pub playing: bool,
}
impl Observation {
    pub fn valid(&self) -> bool {
        if self.kind == "unavailable" {
            return self.video_id.is_none() && self.title.is_empty() && !self.playing;
        }
        self.kind == "watch"
            && self.video_id.as_ref().is_some_and(|s| {
                s.len() == 11
                    && s.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            })
            && !self.title.trim().is_empty()
            && self.title.chars().count() <= 400
            && !self.title.chars().any(char::is_control)
    }
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Message {
    pub version: u8,
    #[serde(rename = "type")]
    pub kind: String,
    pub generation: u64,
    pub seq: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observation: Option<Observation>,
}
impl Message {
    pub fn valid(&self) -> bool {
        self.version == 1
            && self.seq > 0
            && self.seq <= 9_007_199_254_740_991
            && match self.kind.as_str() {
                "heartbeat" | "clear" => self.observation.is_none(),
                "observation" => self.observation.as_ref().is_some_and(Observation::valid),
                _ => false,
            }
    }
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Status {
    #[serde(rename = "type")]
    pub kind: String,
    pub connected: bool,
    pub collecting: bool,
    pub generation: u64,
}
impl Status {
    pub fn offline() -> Self {
        Self {
            kind: "status".into(),
            connected: false,
            collecting: false,
            generation: 0,
        }
    }
}
pub fn read_frame(reader: &mut impl Read) -> io::Result<Vec<u8>> {
    let mut length = [0; 4];
    reader.read_exact(&mut length)?;
    let length = u32::from_le_bytes(length) as usize;
    if length == 0 || length > LIMIT {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "frame size"));
    }
    let mut bytes = vec![0; length];
    reader.read_exact(&mut bytes)?;
    Ok(bytes)
}
pub fn write_frame(writer: &mut impl Write, bytes: &[u8]) -> io::Result<()> {
    if bytes.is_empty() || bytes.len() > LIMIT {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "frame size"));
    }
    writer.write_all(&(bytes.len() as u32).to_le_bytes())?;
    writer.write_all(bytes)?;
    writer.flush()
}
pub fn origin_valid(origin: &str) -> bool {
    origin
        .strip_prefix("chrome-extension://")
        .and_then(|s| s.strip_suffix('/'))
        .is_some_and(|id| id.len() == 32 && id.bytes().all(|b| (b'a'..=b'p').contains(&b)))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_frames() {
        let mut bytes = vec![];
        write_frame(&mut bytes, b"test").unwrap();
        assert_eq!(read_frame(&mut bytes.as_slice()).unwrap(), b"test");
        assert!(read_frame(&mut [255, 255, 255, 255].as_slice()).is_err());
        assert!(read_frame(&mut [0, 0, 0, 0].as_slice()).is_err());
        assert!(read_frame(&mut [4, 0, 0, 0, 1].as_slice()).is_err());
    }
    #[test]
    fn strict_input_and_origin() {
        assert!(origin_valid(
            "chrome-extension://abcdefghijklmnopabcdefghijklmnop/"
        ));
        assert!(!origin_valid("chrome-extension://*/"));
        let bad = r#"{"version":1,"type":"clear","generation":1,"seq":1,"extra":1}"#;
        assert!(serde_json::from_str::<Message>(bad).is_err());
        let mut o = Observation {
            kind: "watch".into(),
            video_id: Some("abcdefghijk".into()),
            title: "강의".into(),
            playing: true,
        };
        assert!(o.valid());
        o.title = "x".repeat(401);
        assert!(!o.valid());
        o.kind = "shorts".into();
        assert!(!o.valid());
    }
}
