//! Local, same-Windows-user pipe. No TCP listener, files containing activity, or registry writes.
use crate::LIMIT;
use std::{
    io, ptr,
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::*,
    Security::{Authorization::*, *},
    Storage::FileSystem::*,
    System::{Pipes::*, Threading::*},
};
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}
struct Handle(HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}
unsafe impl Send for Handle {}
fn user_sid() -> io::Result<String> {
    unsafe {
        let mut token = ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return Err(io::Error::last_os_error());
        }
        let token = Handle(token);
        let mut size = 0;
        GetTokenInformation(token.0, TokenUser, ptr::null_mut(), 0, &mut size);
        let mut data = vec![0usize; (size as usize).div_ceil(std::mem::size_of::<usize>())];
        if GetTokenInformation(
            token.0,
            TokenUser,
            data.as_mut_ptr().cast(),
            size,
            &mut size,
        ) == 0
        {
            return Err(io::Error::last_os_error());
        }
        let info = &*(data.as_ptr().cast::<TOKEN_USER>());
        let mut text = ptr::null_mut();
        if ConvertSidToStringSidW(info.User.Sid, &mut text) == 0 {
            return Err(io::Error::last_os_error());
        }
        let mut len = 0;
        while *text.add(len) != 0 {
            len += 1;
        }
        let sid = String::from_utf16_lossy(std::slice::from_raw_parts(text, len));
        LocalFree(text.cast());
        Ok(sid)
    }
}
fn name(sid: &str) -> Vec<u16> {
    wide(&format!(r"\\.\pipe\IN-VIBE.YouTube.{sid}"))
}
pub struct Pipe {
    handle: Handle,
    pending: Vec<u8>,
}
impl Pipe {
    pub fn server() -> io::Result<Self> {
        Self::server_named("")
    }
    fn server_named(suffix: &str) -> io::Result<Self> {
        let sid = user_sid()?;
        unsafe {
            let mut descriptor = ptr::null_mut();
            let sddl = wide(&format!("D:P(A;;GA;;;SY)(A;;GA;;;{sid})"));
            if ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                ptr::null_mut(),
            ) == 0
            {
                return Err(io::Error::last_os_error());
            }
            let attrs = SECURITY_ATTRIBUTES {
                nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: descriptor,
                bInheritHandle: 0,
            };
            let h = CreateNamedPipeW(
                name(&format!("{sid}{suffix}")).as_ptr(),
                PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_NOWAIT | PIPE_REJECT_REMOTE_CLIENTS,
                1,
                16384,
                16384,
                0,
                &attrs,
            );
            let error = io::Error::last_os_error();
            LocalFree(descriptor);
            if h == INVALID_HANDLE_VALUE {
                return Err(error);
            }
            Ok(Self {
                handle: Handle(h),
                pending: vec![],
            })
        }
    }
    pub fn connect(&self) -> io::Result<bool> {
        unsafe {
            if ConnectNamedPipe(self.handle.0, ptr::null_mut()) != 0 {
                return Ok(true);
            }
            match GetLastError() {
                ERROR_PIPE_CONNECTED => Ok(true),
                ERROR_PIPE_LISTENING => Ok(false),
                _ => Err(io::Error::last_os_error()),
            }
        }
    }
    pub fn disconnect(&mut self) {
        unsafe {
            DisconnectNamedPipe(self.handle.0);
        }
        self.pending.clear();
    }
    pub fn client() -> io::Result<Self> {
        Self::client_named("")
    }
    fn client_named(suffix: &str) -> io::Result<Self> {
        unsafe {
            let h = CreateFileW(
                name(&format!("{}{suffix}", user_sid()?)).as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                0,
                ptr::null(),
                OPEN_EXISTING,
                0,
                ptr::null_mut(),
            );
            if h == INVALID_HANDLE_VALUE {
                return Err(io::Error::last_os_error());
            }
            let handle = Handle(h);
            let mode = PIPE_READMODE_BYTE | PIPE_NOWAIT;
            if SetNamedPipeHandleState(h, &mode, ptr::null(), ptr::null()) == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(Self {
                handle,
                pending: vec![],
            })
        }
    }
    pub fn receive(&mut self) -> io::Result<Option<Vec<u8>>> {
        unsafe {
            let mut available = 0;
            if PeekNamedPipe(
                self.handle.0,
                ptr::null_mut(),
                0,
                ptr::null_mut(),
                &mut available,
                ptr::null_mut(),
            ) == 0
            {
                return Err(io::Error::last_os_error());
            }
            if available > 0 {
                let mut buf = [0u8; LIMIT + 4];
                let mut read = 0;
                if ReadFile(
                    self.handle.0,
                    buf.as_mut_ptr(),
                    available.min(buf.len() as u32),
                    &mut read,
                    ptr::null_mut(),
                ) == 0
                {
                    return Err(io::Error::last_os_error());
                }
                self.pending.extend_from_slice(&buf[..read as usize]);
            }
        }
        if self.pending.len() > LIMIT + 4 {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "pipe overflow"));
        }
        if self.pending.len() < 4 {
            return Ok(None);
        }
        let size = u32::from_le_bytes(self.pending[..4].try_into().unwrap()) as usize;
        if size == 0 || size > LIMIT {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "pipe size"));
        }
        if self.pending.len() < size + 4 {
            return Ok(None);
        }
        let payload = self.pending[4..size + 4].to_vec();
        self.pending.drain(..size + 4);
        Ok(Some(payload))
    }
    pub fn send(&mut self, bytes: &[u8]) -> io::Result<()> {
        let mut frame = vec![];
        crate::write_frame(&mut frame, bytes)?;
        unsafe {
            let mut written = 0;
            if WriteFile(
                self.handle.0,
                frame.as_ptr(),
                frame.len() as u32,
                &mut written,
                ptr::null_mut(),
            ) == 0
                || written != frame.len() as u32
            {
                return Err(io::Error::new(io::ErrorKind::BrokenPipe, "pipe write"));
            }
        }
        Ok(())
    }
    pub fn request(&mut self, bytes: &[u8]) -> io::Result<Vec<u8>> {
        self.send(bytes)?;
        let deadline = Instant::now() + Duration::from_millis(750);
        while Instant::now() < deadline {
            if let Some(bytes) = self.receive()? {
                return Ok(bytes);
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        Err(io::Error::new(io::ErrorKind::TimedOut, "app unavailable"))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn real_windows_pipe_roundtrip_exclusive_and_disconnect() {
        let suffix = format!(".test.{}", std::process::id());
        let mut server = Pipe::server_named(&suffix).unwrap();
        assert!(Pipe::server_named(&suffix).is_err());
        assert!(!server.connect().unwrap());
        let worker = std::thread::spawn(move || {
            let mut client = Pipe::client_named(&suffix).unwrap();
            assert_eq!(client.request(b"hello").unwrap(), b"accepted");
        });
        let deadline = Instant::now() + Duration::from_secs(2);
        while !server.connect().unwrap() {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        loop {
            if let Some(frame) = server.receive().unwrap() {
                assert_eq!(frame, b"hello");
                server.send(b"accepted").unwrap();
                break;
            }
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        worker.join().unwrap();
        assert!(server.receive().is_err());
        server.disconnect();
    }
}
