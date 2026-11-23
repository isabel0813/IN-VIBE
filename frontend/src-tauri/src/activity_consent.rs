use std::{
    fs,
    io::{self, Read, Write},
    path::Path,
};

const GRANTED: &[u8] = b"granted-v1\n";

pub fn load(path: &Path) -> io::Result<bool> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error),
    };
    let mut contents = Vec::new();
    file.take(GRANTED.len() as u64 + 1)
        .read_to_end(&mut contents)?;
    Ok(contents == GRANTED)
}

pub fn save(path: &Path, consent: bool) -> io::Result<()> {
    if consent {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut file = fs::File::create(path)?;
        if let Err(error) = file.write_all(GRANTED).and_then(|_| file.sync_all()) {
            drop(file);
            let _ = fs::remove_file(path);
            return Err(error);
        }
        Ok(())
    } else {
        match fs::remove_file(path) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            // If the directory denies deletion but the file is writable,
            // invalidate the grant by truncating it instead.
            Err(_) => fs::OpenOptions::new()
                .write(true)
                .truncate(true)
                .open(path)?
                .sync_all(),
            Ok(()) => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::activity::{Config, Detector, Sample};

    fn config(consent: bool) -> Config {
        Config {
            consent,
            threshold_seconds: 300,
            related_terms: vec![],
            suspect_terms: vec![],
        }
    }

    #[test]
    fn restores_only_explicit_consent_and_never_samples_outside_an_active_session() {
        let directory = std::env::temp_dir().join(format!(
            "mobonyong-activity-consent-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let file = directory.join("activity-consent");
        assert!(!load(&file).unwrap());
        let mut first = Detector::default();
        first
            .configure_with(config(true), false, |consent| {
                save(&file, consent).map_err(|error| error.to_string())
            })
            .unwrap();
        let mut restarted = Detector::default();
        restarted.view.consent = load(&file).unwrap();
        assert!(restarted.view.consent);
        assert!(!restarted.view.monitoring);
        assert!(!restarted.poll(false, false, 0, || panic!("sampled before start")));
        restarted.poll(true, false, 1_000, || Ok(Sample::default()));
        assert!(restarted.view.monitoring);
        assert!(!restarted.poll(true, true, 2_000, || panic!("sampled while paused")));
        assert!(!restarted.view.monitoring);
        assert!(!restarted.poll(false, false, 3_000, || panic!("sampled after end")));
        restarted
            .configure_with(config(false), false, |consent| {
                save(&file, consent).map_err(|error| error.to_string())
            })
            .unwrap();
        assert!(!restarted.view.consent);
        assert!(!load(&file).unwrap());
        fs::write(&file, b"granted").unwrap();
        assert!(!load(&file).unwrap());
        fs::remove_file(file).unwrap();
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn failed_storage_does_not_grant_consent_or_delay_revocation() {
        let mut detector = Detector::default();
        let fail = |_| Err("storage unavailable".to_owned());
        assert!(detector.configure_with(config(true), false, fail).is_err());
        assert!(!detector.view.consent);
        detector
            .configure_with(config(true), false, |_| Ok(()))
            .unwrap();
        let revision = detector.view.revision;
        assert!(detector.configure_with(config(false), false, fail).is_err());
        assert!(!detector.view.consent);
        assert!(detector.view.revision > revision);
    }
}
