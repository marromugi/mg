use std::io::{BufRead, BufReader, Read};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

const LINK_PREFIX: &str = "http://127.0.0.1:";

/// How long the server has to print its launch link.
pub const LINK_WAIT: Duration = Duration::from_secs(10);

#[derive(Debug, PartialEq)]
pub enum LinkFailure {
    TimedOut,
    Closed,
    NotALink(String),
}

impl LinkFailure {
    pub fn describe(&self) -> String {
        match self {
            LinkFailure::TimedOut => format!(
                "The server printed no launch link within {} seconds.",
                LINK_WAIT.as_secs()
            ),
            LinkFailure::Closed => "The server exited before it printed a launch link.".to_string(),
            LinkFailure::NotALink(line) => {
                format!("The server's first line is not a launch link: {line}")
            }
        }
    }
}

/// Reads the server's first stdout line as the launch link. The rest of
/// stdout is drained so the server never blocks on a full pipe.
pub fn read_launch_link<R: Read + Send + 'static>(
    stdout: R,
    timeout: Duration,
) -> Result<String, LinkFailure> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let outcome = match reader.read_line(&mut line) {
            Ok(0) | Err(_) => Err(LinkFailure::Closed),
            Ok(_) => parse_link(line.trim_end()),
        };
        let _ = sender.send(outcome);
        let _ = std::io::copy(&mut reader, &mut std::io::sink());
    });
    receiver
        .recv_timeout(timeout)
        .unwrap_or(Err(LinkFailure::TimedOut))
}

fn parse_link(line: &str) -> Result<String, LinkFailure> {
    if line.starts_with(LINK_PREFIX) {
        Ok(line.to_string())
    } else {
        Err(LinkFailure::NotALink(line.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{pipe, Cursor};

    const SHORT: Duration = Duration::from_millis(100);

    #[test]
    fn the_first_line_is_the_launch_link() {
        let stdout = Cursor::new("http://127.0.0.1:51234/enter?token=abc\nlater\n");
        assert_eq!(
            read_launch_link(stdout, SHORT),
            Ok("http://127.0.0.1:51234/enter?token=abc".to_string())
        );
    }

    #[test]
    fn a_server_that_exits_without_a_line_is_closed() {
        assert_eq!(
            read_launch_link(Cursor::new(""), SHORT),
            Err(LinkFailure::Closed)
        );
    }

    #[test]
    fn a_first_line_that_is_not_a_link_is_refused() {
        assert_eq!(
            read_launch_link(Cursor::new("hello\n"), SHORT),
            Err(LinkFailure::NotALink("hello".to_string()))
        );
    }

    #[test]
    fn a_server_that_stays_silent_times_out() {
        let (reader, _writer) = pipe().unwrap();
        assert_eq!(read_launch_link(reader, SHORT), Err(LinkFailure::TimedOut));
    }
}
